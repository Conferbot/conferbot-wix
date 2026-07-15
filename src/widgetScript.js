'use strict';

/**
 * Bot ID helpers plus the embedded-script HTML. In production the HTML
 * template (embedded-script.html, with {{botId}}/{{embedType}} placeholders)
 * lives in the Wix Dev Center and Wix renders it into every page of the
 * site; buildEmbeddedScriptHtml() produces the same output for the local
 * preview endpoint, tests and the demo recording.
 */

const BOT_ID_RE = /^[a-f0-9]{24}$/i;

function isValidBotId(id) {
  return BOT_ID_RE.test(String(id || ''));
}

function extractBotId(text) {
  const m = String(text || '').match(/[a-f0-9]{24}/i);
  return m ? m[0] : '';
}

function buildEmbeddedScriptHtml(botId, embedType, cfg) {
  if (!isValidBotId(botId)) {
    return '<!-- conferbot: not configured -->\n';
  }
  const type = embedType === 'popup_chat' ? 'popup_chat' : 'live_chat';
  const src = String(cfg.widgetScriptUrl).replace(/[<>"&]/g, '');

  return `<script type="text/javascript">
  (function (d, s, id) {
    var js, el = d.getElementsByTagName(s)[0];
    if (d.getElementById(id)) return;
    js = d.createElement(s);
    js.async = true;
    js.src = '${src}';
    js.id = id;
    js.charset = 'UTF-8';
    if (el && el.parentNode) { el.parentNode.insertBefore(js, el); } else { d.head.appendChild(js); }
    js.onload = function () {
      window.ConferbotWidget('${botId}', '${type}', { customData: { platform: 'wix' } });
    };
  })(document, 'script', 'conferbot-js');
</script>
`;
}

module.exports = { isValidBotId, extractBotId, buildEmbeddedScriptHtml };
