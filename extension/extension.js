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

// The extension also runs on the lock screen ("session-modes" in
// metadata.json) so a running timer still rings there. The widgets
// themselves are removed while locked; only the timer model keeps going.
export default class LiquidGlassWidgets extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._widgets = new Map();
        this.timerModel = new TimerModel(this._settings);

        this.widgetGroup = new Clutter.Actor();
        global.window_group.add_child(this.widgetGroup);
        this._restackWidgetGroup();

        for (const {key} of WIDGETS)
            this._settings.connectObject(`changed::${key}`, () => this._sync(), this);
        Main.sessionMode.connectObject('updated', () => this._sync(), this);
        global.display.connectObject('restacked', () => this._restackWidgetGroup(), this);
        global.window_group.connectObject('child-added', () => this._restackWidgetGroup(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        global.display.disconnectObject(this);
        global.window_group.disconnectObject(this);
        for (const widget of this._widgets.values())
            widget.destroy();
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
        if (!this.widgetGroup?.get_parent())
            return;

        let sibling = Main.layoutManager._backgroundGroup;
        for (const actor of global.get_window_actors()) {
            if (actor.get_parent() !== global.window_group)
                continue;
            const win = actor.meta_window;
            if (win && win.get_window_type() === Meta.WindowType.DESKTOP)
                sibling = actor;
        }
        if (sibling && sibling.get_parent() === global.window_group)
            global.window_group.set_child_above_sibling(this.widgetGroup, sibling);
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
