/**
 * peartree-embed.js  — thin backward-compatible shim
 *
 * Exposes `window.PearTreeEmbed.embed(options)` for pages that load this
 * script via a plain <script src="…"> tag.  The implementation now lives in
 * peartree.js; this shim loads it as an ES module and forwards the call.
 */
(function () {
  'use strict';

  var scriptEl = document.currentScript;

  var pc = window.__pearcore_embed__;
  if (!pc) {
    console.error('peartree-embed.js: pearcore-embed.js must be loaded first');
    return;
  }

  window.PearTreeEmbed = {
    embed: pc.createEmbed({
      scriptEl:    scriptEl,
      modulePath:  'js/peartree.js',
      globalName:  'PearTree',
      stylesheets: [
        'css/peartree.css',
        'css/peartree-embed.css',
      ],
    }),
  };
})();
