(function () {
  'use strict';

  function detectBase(scriptEl) {
    const src = ((scriptEl || document.currentScript || {}).src || '');
    const dir = src ? src.substring(0, src.lastIndexOf('/') + 1) : '';
    return dir ? dir + '../' : '';
  }

  function ensureStylesheet(href) {
    const a = document.createElement('a');
    a.href = href;
    const abs = a.href;
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    for (let i = 0; i < links.length; i++) {
      if (links[i].href === abs) return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = abs;
    document.head.appendChild(link);
  }

  function loadScript(src, isModule) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var el = document.createElement('script');
      if (isModule) el.type = 'module';
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('pearcore-embed: failed to load ' + src)); };
      document.head.appendChild(el);
    });
  }

  function createEmbed(config) {
    var scriptEl = config.scriptEl || document.currentScript;
    var autoBase = detectBase(scriptEl);

    return function embed(options) {
      if (!options) throw new Error('embed: options object is required');

      var base = typeof options.base === 'string' ? options.base : autoBase;

      for (var i = 0; i < config.stylesheets.length; i++) {
        ensureStylesheet(base + config.stylesheets[i]);
      }

      loadScript(base + config.modulePath, true).then(function () {
        var appGlobal = window[config.globalName];
        if (!appGlobal || typeof appGlobal.embed !== 'function') {
          throw new Error('embed: ' + config.globalName + '.embed() not found after loading module');
        }
        return appGlobal.embed(Object.assign({ base: base }, options));
      }).catch(function (err) {
        console.error(err);
      });
    };
  }

  window.__pearcore_embed__ = {
    detectBase: detectBase,
    ensureStylesheet: ensureStylesheet,
    loadScript: loadScript,
    createEmbed: createEmbed,
  };
})();
