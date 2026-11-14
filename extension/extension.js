import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {clearImageCache} from './lib/draw.js';
import {TimerModel} from './lib/timerModel.js';
import {AnalogClock} from './widgets/clockAnalog.js';
import {DigitalClock} from './widgets/clockDigital.js';
import {GlassTextClock} from './widgets/clockGlassText.js';
import {CalendarWidget} from './widgets/calendar.js';
import {MusicWidget} from './widgets/music.js';
import {TimerWidget} from './widgets/timer.js';
import {WeatherWidget} from './widgets/weather.js';
import {CityAnalogClock, CityDigitalClock, CityMultiClock} from './widgets/worldClock.js';

// Each entry: settings key that toggles the widget, and its class.
const WIDGETS = [
    {key: 'clock-analog-enabled', create: (ext, settings) => new AnalogClock(ext, settings, 'clock-analog')},
    {key: 'clock-analog-2-enabled', create: (ext, settings) => new AnalogClock(ext, settings, 'clock-analog-2')},
    {key: 'clock-analog-3-enabled', create: (ext, settings) => new AnalogClock(ext, settings, 'clock-analog-3')},
    {key: 'clock-digital-enabled', create: (ext, settings) => new DigitalClock(ext, settings)},
    {key: 'clock-glass-text-enabled', create: (ext, settings) => new GlassTextClock(ext, settings)},
    {key: 'city-1-enabled', create: (ext, settings) => new CityMultiClock(ext, settings, 'city-1')},
    {key: 'city-2-enabled', create: (ext, settings) => new CityMultiClock(ext, settings, 'city-2')},
    {key: 'city-3-enabled', create: (ext, settings) => new CityAnalogClock(ext, settings)},
    {key: 'city-digital-enabled', create: (ext, settings) => new CityDigitalClock(ext, settings)},
    {key: 'calendar-enabled', create: (ext, settings) => new CalendarWidget(ext, settings)},
    {key: 'weather-enabled', create: (ext, settings) => new WeatherWidget(ext, settings)},
    {key: 'timer-enabled', create: (ext, settings) => new TimerWidget(ext, settings)},
    {key: 'music-enabled', create: (ext, settings) => new MusicWidget(ext, settings)},
];

const OVERVIEW_ANIM_MS = 240;
const OVERVIEW_SCATTER_MARGIN = 48;
const OVERVIEW_SCATTER_SCALE = 0.92;

// The extension also runs on the lock screen ("session-modes" in
// metadata.json) so a running timer still rings there. The widgets
// themselves are removed while locked; only the timer model keeps going.
export default class LiquidGlassWidgets extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._widgets = new Map();
        this._animGen = 0;
        this.timerModel = new TimerModel(this._settings);

        this.widgetGroup = new Clutter.Actor({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        global.window_group.add_child(this.widgetGroup);
        this._restackWidgetGroup();

        for (const {key} of WIDGETS)
            this._settings.connectObject(`changed::${key}`, () => this._sync(), this);
        Main.sessionMode.connectObject('updated', () => this._sync(), this);
        Main.overview.connectObject(
            'showing', () => this._onOverviewShowing(),
            'hiding', () => this._onOverviewHiding(),
            'hidden', () => this._onOverviewHidden(),
            this
        );
        global.display.connectObject('restacked', () => this._restackWidgetGroup(), this);
        global.window_group.connectObject('child-added', () => this._restackWidgetGroup(), this);
        this._sync();
    }

    disable() {
        this._animGen++;
        this._settings.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.overview.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_group.disconnectObject(this);
        for (const widget of this._widgets.values()) {
            widget.remove_all_transitions();
            widget.destroy();
        }
        this._widgets = null;
        this.widgetGroup.destroy();
        this.widgetGroup = null;
        this.timerModel.destroy();
        this.timerModel = null;
        this._settings = null;
        clearImageCache();
    }

    // Keep widgetGroup above the wallpaper and any desktop-icons window
    // (e.g. DING's Meta.WindowType.DESKTOP window), but below every normal
    // window. Mutter's sync_actor_stacking pushes _backgroundGroup to the
    // very bottom of window_group below DESKTOP windows, so widgets placed
    // inside _backgroundGroup would have their pointer events swallowed by
    // full-screen desktop-icons windows.
    _restackWidgetGroup() {
        if (!this.widgetGroup || this.widgetGroup.get_parent() !== global.window_group)
            return;

        let sibling = Main.layoutManager._backgroundGroup;
        for (const actor of global.get_window_actors()) {
            if (actor.get_parent() !== global.window_group)
                continue;
            const win = actor.meta_window;
            if (win && win.get_window_type() === Meta.WindowType.DESKTOP)
                sibling = actor;
        }
        if (sibling && sibling.get_parent() === global.window_group &&
            this.widgetGroup.get_previous_sibling() !== sibling)
            global.window_group.set_child_above_sibling(this.widgetGroup, sibling);
    }

    _reparentWidgetGroup(targetParent, aboveSibling = null) {
        if (!this.widgetGroup)
            return;
        const currentParent = this.widgetGroup.get_parent();
        if (currentParent !== targetParent) {
            currentParent?.remove_child(this.widgetGroup);
            targetParent.add_child(this.widgetGroup);
        }
        if (aboveSibling && aboveSibling.get_parent() === targetParent &&
            this.widgetGroup.get_previous_sibling() !== aboveSibling)
            targetParent.set_child_above_sibling(this.widgetGroup, aboveSibling);
    }

    _getOccludedMonitors() {
        const occluded = new Set();
        const ws = global.workspace_manager.get_active_workspace();
        if (!ws)
            return occluded;

        for (const win of ws.list_windows()) {
            if (win.minimized || !win.showing_on_its_workspace())
                continue;
            const type = win.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK)
                continue;
            if (win.customJS_ding || win.get_gtk_application_id?.() === 'com.rastersoft.ding')
                continue;
            const maximized = typeof win.is_maximized === 'function'
                ? win.is_maximized()
                : (win.maximized_horizontally && win.maximized_vertically);
            if (maximized || win.is_fullscreen())
                occluded.add(win.get_monitor());
        }
        return occluded;
    }

    _scatterOffset(widget, monIdx) {
        const mon = Main.layoutManager.monitors[monIdx] ?? Main.layoutManager.primaryMonitor;
        if (!mon)
            return {tx: 0, ty: -200};

        const wx = widget.x + widget.width * 0.5;
        const wy = widget.y + widget.height * 0.5;
        const mx = mon.x + mon.width * 0.5;
        const my = mon.y + mon.height * 0.5;

        let dx = wx - mx;
        let dy = wy - my;
        if (dx === 0 && dy === 0)
            dy = -1;

        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;

        const txDist = ux > 0.001
            ? ((mon.x + mon.width + OVERVIEW_SCATTER_MARGIN) - widget.x) / ux
            : ux < -0.001
                ? ((widget.x + widget.width) - (mon.x - OVERVIEW_SCATTER_MARGIN)) / (-ux)
                : Infinity;
        const tyDist = uy > 0.001
            ? ((mon.y + mon.height + OVERVIEW_SCATTER_MARGIN) - widget.y) / uy
            : uy < -0.001
                ? ((widget.y + widget.height) - (mon.y - OVERVIEW_SCATTER_MARGIN)) / (-uy)
                : Infinity;

        const dist = Math.min(txDist, tyDist);
        return {tx: Math.round(ux * dist), ty: Math.round(uy * dist)};
    }

    _resetWidgetTransform(widget) {
        widget.remove_all_transitions();
        widget.set({
            translation_x: 0,
            translation_y: 0,
            scale_x: 1,
            scale_y: 1,
            opacity: 255,
        });
        widget.show();
    }

    _onOverviewShowing() {
        if (!this.widgetGroup || !this._widgets?.size)
            return;

        const occluded = this._getOccludedMonitors();
        const animWidgets = [];
        for (const widget of this._widgets.values()) {
            const monIdx = Main.layoutManager.findIndexForActor(widget);
            if (!occluded.has(monIdx))
                animWidgets.push([widget, monIdx]);
        }

        // Skip animation and reparenting completely when all monitors with widgets are occluded.
        if (animWidgets.length === 0) {
            this._animGen++;
            return;
        }

        const gen = ++this._animGen;
        this.widgetGroup.reactive = false;
        this._reparentWidgetGroup(Main.layoutManager.uiGroup, Main.layoutManager.overviewGroup);
        this.widgetGroup.show();

        for (const widget of this._widgets.values()) {
            const monIdx = Main.layoutManager.findIndexForActor(widget);
            if (occluded.has(monIdx)) {
                widget.remove_all_transitions();
                widget.hide();
            }
        }

        let remaining = animWidgets.length;
        for (const [widget, monIdx] of animWidgets) {
            const {tx, ty} = this._scatterOffset(widget, monIdx);
            widget.set_pivot_point(0.5, 0.5);
            widget.show();
            widget.remove_all_transitions();
            widget.ease({
                translation_x: tx,
                translation_y: ty,
                scale_x: OVERVIEW_SCATTER_SCALE,
                scale_y: OVERVIEW_SCATTER_SCALE,
                opacity: 0,
                duration: OVERVIEW_ANIM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onStopped: () => {
                    if (gen !== this._animGen)
                        return;
                    widget.hide();
                    if (--remaining === 0 && this.widgetGroup)
                        this.widgetGroup.hide();
                },
            });
        }
    }

    _onOverviewHiding() {
        if (!this.widgetGroup || !this._widgets?.size)
            return;

        const occluded = this._getOccludedMonitors();
        const animWidgets = [];
        for (const widget of this._widgets.values()) {
            const monIdx = Main.layoutManager.findIndexForActor(widget);
            if (!occluded.has(monIdx))
                animWidgets.push([widget, monIdx]);
        }

        if (animWidgets.length === 0) {
            this._animGen++;
            return;
        }

        const gen = ++this._animGen;
        this.widgetGroup.reactive = false;
        this._reparentWidgetGroup(Main.layoutManager.uiGroup, Main.layoutManager.overviewGroup);
        this.widgetGroup.show();

        for (const widget of this._widgets.values()) {
            const monIdx = Main.layoutManager.findIndexForActor(widget);
            if (occluded.has(monIdx))
                this._resetWidgetTransform(widget);
        }

        for (const [widget, monIdx] of animWidgets) {
            widget.set_pivot_point(0.5, 0.5);
            const interruptedMidFlight = widget.visible &&
                (widget.opacity < 255 || widget.translation_x !== 0 || widget.translation_y !== 0);

            widget.remove_all_transitions();
            if (!interruptedMidFlight) {
                const {tx, ty} = this._scatterOffset(widget, monIdx);
                widget.set({
                    translation_x: tx,
                    translation_y: ty,
                    scale_x: OVERVIEW_SCATTER_SCALE,
                    scale_y: OVERVIEW_SCATTER_SCALE,
                    opacity: 0,
                });
            }
            widget.show();
            widget.ease({
                translation_x: 0,
                translation_y: 0,
                scale_x: 1,
                scale_y: 1,
                opacity: 255,
                duration: OVERVIEW_ANIM_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onStopped: () => {
                    if (gen !== this._animGen)
                        return;
                    widget.set({translation_x: 0, translation_y: 0, scale_x: 1, scale_y: 1, opacity: 255});
                },
            });
        }
    }

    _onOverviewHidden() {
        if (!this.widgetGroup)
            return;

        this._animGen++;
        this.widgetGroup.reactive = true;
        this.widgetGroup.show();
        for (const widget of this._widgets.values())
            this._resetWidgetTransform(widget);

        this._reparentWidgetGroup(global.window_group);
        this._restackWidgetGroup();
    }

    _sync() {
        const locked = Main.sessionMode.isLocked;

        for (const {key, create} of WIDGETS) {
            const wanted = !locked && this._settings.get_boolean(key);
            const widget = this._widgets.get(key);

            if (wanted && !widget) {
                this._widgets.set(key, create(this, this._settings));
            } else if (!wanted && widget) {
                widget.destroy();
                this._widgets.delete(key);
            }
        }
    }
}
