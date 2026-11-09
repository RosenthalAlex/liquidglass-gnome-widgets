// Version-independent GLSL offscreen effect.
//
// GNOME Shell 48-50 ship Shell.GLSLEffect (uniforms addressed by location,
// snippet added in vfunc_build_pipeline). GNOME Shell 51 removed it in
// favour of Clutter.ShaderEffect, which takes a Cogl.Snippet from
// vfunc_get_static_snippet() and addresses uniforms by name.
//
// makeShaderEffect() hides the difference: the returned class has a
// setUniform(name, values) method taking the uniform name without its prefix
// and an array of floats (one vecN / float uniform), on every version.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

// declarations / code: the fragment snippet
// (code replaces Cogl's default fragment body); prefix: prepended to every
// uniform name; uniforms: unprefixed names setUniform() will be called with.
export function makeShaderEffect(declarations, code, prefix, uniforms) {
    // Anonymous classes would all get the same automatic GType name.
    const meta = {GTypeName: `Gjs_LiquidGlassWidgets_${prefix}ShaderEffect`};

    if (Shell.GLSLEffect) {
        return GObject.registerClass(meta,
        class extends Shell.GLSLEffect {
            _init() {
                super._init();
                this._locations = {};
                for (const name of uniforms)
                    this._locations[name] = this.get_uniform_location(`${prefix}${name}`);
            }

            vfunc_build_pipeline() {
                this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, declarations, code, true);
            }

            setUniform(name, values) {
                this.set_uniform_float(this._locations[name], values.length, values);
            }
        });
    }

    return GObject.registerClass(meta,
    class extends Clutter.ShaderEffect {
        vfunc_get_static_snippet() {
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, null);
            snippet.set_replace(code);
            return snippet;
        }

        setUniform(name, values) {
            this.set_uniform_float(`${prefix}${name}`, values.length, values);
        }
    });
}
