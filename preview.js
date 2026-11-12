'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createPreview(cache, runFfmpeg) {
  const active = new Map();
  return async function preview(source) {
    const hash = crypto.createHash('sha256').update('preview-960p-30-v1');
    for await (const bytes of fs.createReadStream(source)) hash.update(bytes);
    const name = `preview_${hash.digest('hex')}.mp4`, target = path.join(cache, name);
    if (fs.existsSync(target)) return { url: `/cache/${name}` };
    if (!active.has(name)) {
      const task = (async () => {
        const temporary = target + '.part.mp4';
        try {
          await runFfmpeg(['-i', source, '-map', '0:v:0', '-map', '0:a:0?',
            '-vf', "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-threads', '2',
            '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-bf', '0', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', temporary]);
          await fs.promises.rename(temporary, target);
        } finally { await fs.promises.unlink(temporary).catch(() => {}); }
        return { url: `/cache/${name}` };
      })();
      active.set(name, task);
      task.finally(() => active.delete(name)).catch(() => {});
    }
    return active.get(name);
  };
};
