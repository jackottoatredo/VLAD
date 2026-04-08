/**
 * mouse-relay.js
 *
 * Drop into redo.com and reference from the root layout:
 *   import Script from 'next/script'
 *   <Script src="/mouse-relay.js" strategy="afterInteractive" />
 *
 * When loaded inside an iframe this script relays pointer events to the
 * parent page via postMessage so the parent can track mouse activity that
 * the browser would otherwise swallow at the iframe boundary.
 * Has no effect when loaded in a top-level window.
 */
(function () {
  if (window.parent === window) return;

  var rafPending = false;
  var pendingMove = null;

  function send(payload) {
    window.parent.postMessage({ source: 'mouse-relay', payload: payload }, '*');
  }

  function onPointerMove(e) {
    pendingMove = {
      eventType: 'pointermove',
      x: e.clientX,
      y: e.clientY,
      buttons: e.buttons,
      timestamp: e.timeStamp,
    };
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(function () {
        if (pendingMove) send(pendingMove);
        pendingMove = null;
        rafPending = false;
      });
    }
  }

  function onDiscreteEvent(e) {
    send({
      eventType: e.type,
      x: e.clientX,
      y: e.clientY,
      buttons: e.buttons,
      timestamp: e.timeStamp,
    });
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onDiscreteEvent);
  window.addEventListener('pointerup', onDiscreteEvent);
  window.addEventListener('click', onDiscreteEvent);
})();
