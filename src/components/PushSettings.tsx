import React, { useEffect, useState } from 'react';
import { useApi } from '../utils/api';

type State = 'loading' | 'on' | 'off' | 'blocked' | 'unsupported' | 'ios-install';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhones/iPads only allow notifications for sites added to the home screen and opened from there
const iosNeedsInstall = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(navigator as { standalone?: boolean }).standalone &&
  !matchMedia('(display-mode: standalone)').matches;
const keyBytes = (b64: string) =>
  Uint8Array.from(atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Profile section: turn push notifications on or off for this phone/computer, and send a test. */
const PushSettings: React.FC = () => {
  const api = useApi();
  const [state, setState] = useState<State>('loading');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (iosNeedsInstall()) return setState('ios-install');
    if (!supported()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    navigator.serviceWorker
      .getRegistration('/')
      .then((r) => r?.pushManager.getSubscription())
      .then(
        (s) => setState(s ? 'on' : 'off'),
        () => setState('off'),
      );
  }, []);

  const turnOn = async () => {
    setMsg('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked'); // must come first: it needs the click
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { key } = await api('/api/push/key');
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      setState('on');
      setMsg('On. You can send yourself a test.');
    } catch (e) {
      setMsg(`Couldn't turn them on: ${(e as Error).message}`);
    }
  };
  const turnOff = async () => {
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    setState('off');
    setMsg('Off on this device.');
  };
  const test = () =>
    api('/api/push/test', { method: 'POST' }).then(
      () => setMsg('Test sent. It should pop up in a few seconds.'),
      (e) => setMsg(e.message),
    );

  return (
    <div style={{ border: '2px groove #fff', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <b>Notifications on this device</b>
      <div style={{ color: '#444' }}>Project updates, your turn coming up, and direct messages, even when Sanktuary is closed.</div>
      {state === 'ios-install' && (
        <div>
          On iPhone/iPad: tap <b>Share</b> → <b>Add to Home Screen</b>, open Sanktuary from the home screen, then come back here to turn
          them on.
        </div>
      )}
      {state === 'unsupported' && <div>This browser can't do notifications.</div>}
      {state === 'blocked' && <div>Notifications are blocked for this site. Allow them in the browser's site settings, then reload.</div>}
      {(state === 'on' || state === 'off') && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>
            Status: <b>{state === 'on' ? 'On' : 'Off'}</b>
          </span>
          {state === 'off' ? (
            <button style={button} onClick={turnOn}>
              Turn on
            </button>
          ) : (
            <>
              <button style={button} onClick={test}>
                Send test
              </button>
              <button style={button} onClick={turnOff}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}
      {msg && <div style={{ color: '#000080' }}>{msg}</div>}
    </div>
  );
};

const button: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  background: '#c0c0c0',
  borderTop: '1px solid #fff',
  borderLeft: '1px solid #fff',
  borderRight: '1px solid #000',
  borderBottom: '1px solid #000',
};

export default PushSettings;
