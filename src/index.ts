import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sound } from './audio.js';
import { Director } from './director.js';
import { Store } from './store.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const landing = document.getElementById('landing') as HTMLElement;
const enterButton = document.getElementById('enter') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLElement;

function setStatus(message: string): void {
  status.textContent = message;
}

/** Show past sessions on the landing page: the reason to come back. */
function showHistory(): void {
  const section = document.getElementById('history') as HTMLElement;
  const bars = document.getElementById('history-bars') as HTMLElement;
  const text = document.getElementById('history-text') as HTMLElement;
  const store = new Store();
  const sessions = store.sessions;
  if (sessions.length === 0) {
    section.hidden = true;
    return;
  }
  const measured = sessions
    .filter((session) => session.range !== null)
    .map((session) => session.range as number);
  bars.replaceChildren();
  const shown = measured.slice(-14);
  const top = Math.max(0.4, ...shown);
  for (const value of shown) {
    const bar = document.createElement('span');
    bar.style.height = `${Math.round(Math.min(1, value / top) * 100)}%`;
    bars.append(bar);
  }
  bars.hidden = measured.length === 0;
  const days = store.days;
  const parts = [
    `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} on ${days} ${days === 1 ? 'day' : 'days'}`,
  ];
  if (measured.length > 0) {
    const last = Math.round(measured[measured.length - 1] * 100);
    const best = Math.round(Math.max(...measured) * 100);
    parts.push(`last ${last}%`, `best ${best}%`);
  }
  text.textContent = parts.join(' · ');
  section.hidden = false;
}

World.create(container, projectOptions)
  .then(async (world) => {
    world.registerSystem(Director);

    // Is there a headset to enter? On a phone or laptop there usually is not,
    // and it is kinder to say so than to show a button that does nothing.
    let supported = false;
    try {
      supported = (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
    } catch {
      supported = false;
    }
    if (supported) {
      enterButton.disabled = false;
      enterButton.textContent = 'Begin';
      setStatus('Sit down somewhere comfortable. Hands only — no controllers.');
    } else {
      enterButton.textContent = 'Headset needed';
      setStatus('Open this page in the browser on a Meta Quest headset to begin.');
    }

    enterButton.addEventListener('click', () => {
      sound.unlock();
      world.launchXR();
    });

    // The browser's own "Enter VR" button starts a session without our
    // Begin click, so sound is also unlocked by the first pinch in VR.
    let sessionWithUnlock: XRSession | null = null;
    const unlockOnPinch = (): void => sound.unlock();

    world.visibilityState.subscribe((state) => {
      const inVR = state !== VisibilityState.NonImmersive;
      landing.classList.toggle('hidden', inVR);
      if (!inVR) {
        showHistory();
        sound.stopDrone();
        return;
      }
      const session = world.xrSession ?? null;
      if (session && session !== sessionWithUnlock) {
        sessionWithUnlock = session;
        session.addEventListener('selectstart', unlockOnPinch);
      }
      if (state === VisibilityState.Hidden) {
        sound.suspend();
      } else {
        sound.unlock();
        sound.resume();
      }
    });
  })
  .catch((error: unknown) => {
    console.error(error);
    setStatus('Something went wrong while loading. Please reload the page.');
  });
