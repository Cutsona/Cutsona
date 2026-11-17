import { Renderer } from './renderer.js';
import { defaultUniforms } from './edit.js';
import { FILTERS } from './styles.js';

// Grade the composed picture with the editor's shader before captions and logos are drawn.
export function createFilterPreview(redraw) {
  let renderer, source, unavailable = false;
  const canvas = document.createElement('canvas');
  return {
    draw(context, key, time) {
      if (unavailable || key === 'none' || !Object.hasOwn(FILTERS, key)) return;
      const preset = FILTERS[key];
      try {
        renderer ||= new Renderer(canvas, { preview: true, onLutReady: redraw });
        const frame = context.canvas;
        if (source && source !== frame) renderer.forget(source);
        source = frame;
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;
        const uniforms = Object.assign(defaultUniforms(), preset.look, preset.fx, {
          time, lut: preset.lut || '', glow: preset.glow || 0, hue: (preset.hueSpin || 0) * time,
        });
        renderer.render(frame, uniforms);
        context.drawImage(canvas, 0, 0);
      } catch (error) {
        // Remote pictures may be unavailable to WebGL until cached locally.
        if (error.name !== 'SecurityError') unavailable = true;
      }
    },
    reset() {
      if (source) renderer?.forget(source);
      source = null;
    },
  };
}
