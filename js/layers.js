/* Dialog stack with Back-button support.
 *
 * Every menu, panel and modal is a native <dialog> opened with showModal(),
 * which gives focus trapping and top-layer stacking. Each open layer also pushes
 * a history entry so the Android/browser Back button closes the top layer
 * instead of leaving the app. Esc closes the top layer too.
 */
(function (root) {
    const STT = root.STT = root.STT || {};

    const stack = [];
    let pendingPops = 0;
    // History entries from an earlier page load (e.g. after a reload) carry a
    // different session id and are treated as the base calendar screen.
    const sid = Math.random().toString(36).slice(2);
    try { history.replaceState({ sttLayer: 0, sid }, ''); } catch (e) { /* ignore */ }
    const onCloseHandlers = new WeakMap();
    const returnFocus = new WeakMap();

    function top() { return stack[stack.length - 1] || null; }
    function isOpen(dlg) { return stack.includes(dlg); }

    let queued = [];
    let flushTimer = null;

    function flushQueue() {
        clearTimeout(flushTimer);
        pendingPops = 0;
        const q = queued;
        queued = [];
        q.forEach(fn => fn());
    }

    function open(dlg, opts = {}) {
        // A Back traversal from a previous close is still in flight; open after it
        // lands so the new history entry is not swallowed by it.
        if (pendingPops > 0) {
            queued.push(() => open(dlg, opts));
            clearTimeout(flushTimer);
            flushTimer = setTimeout(flushQueue, 400);
            return;
        }
        const { onClose } = opts;
        if (isOpen(dlg)) return;
        returnFocus.set(dlg, document.activeElement);
        if (onClose) onCloseHandlers.set(dlg, onClose); else onCloseHandlers.delete(dlg);
        dlg.showModal();
        stack.push(dlg);
        try { history.pushState({ sttLayer: stack.length, sid }, ''); } catch (e) { /* ignore */ }
        const auto = dlg.querySelector('[autofocus]');
        if (auto) auto.focus();
    }

    function finishClose(dlg) {
        if (dlg.open) dlg.close();
        const handler = onCloseHandlers.get(dlg);
        onCloseHandlers.delete(dlg);
        const back = returnFocus.get(dlg);
        if (back && back.isConnected && typeof back.focus === 'function' && !top()) back.focus({ preventScroll: true });
        if (handler) handler();
    }

    /** Closes the given layer (and anything opened above it). */
    function close(dlg = top()) {
        const i = stack.indexOf(dlg);
        if (i < 0) { if (dlg && dlg.open) dlg.close(); return; }
        const removed = stack.splice(i);
        removed.reverse().forEach(finishClose);
        rewind(removed.length);
    }

    /** Closes every layer, returning to the calendar. */
    function closeAll() {
        if (!stack.length) return;
        close(stack[0]);
    }

    function rewind(n) {
        if (n <= 0) return;
        pendingPops++;
        try { history.go(-n); } catch (e) { pendingPops--; }
    }

    root.addEventListener('popstate', (e) => {
        if (pendingPops > 0) {
            pendingPops--;
            if (pendingPops === 0 && queued.length) flushQueue();
            return;
        }
        const depth = (e.state && e.state.sid === sid && e.state.sttLayer) || 0;
        while (stack.length > depth) finishClose(stack.pop());
    });

    function register(dlg) {
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(dlg); });
        // Closed some other way (e.g. by the browser): keep the stack in sync.
        dlg.addEventListener('close', () => { if (isOpen(dlg)) close(dlg); });
        // Tapping the backdrop closes modals (not full-screen sheets).
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg && (dlg.classList.contains('modal') || dlg.classList.contains('drawer'))) close(dlg);
        });
        dlg.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => close(dlg)));
    }

    STT.layers = { open, close, closeAll, isOpen, top, register };
})(typeof self !== 'undefined' ? self : globalThis);
