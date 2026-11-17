import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sound } from './audio.js';
import { Director } from './director.js';
import { Store, type Settings } from './store.js';
import { planSession } from './tailor.js';

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

/** Say what the next session will be like, and why. */
function showNext(): void {
  const text = document.getElementById('next-text') as HTMLElement;
  const store = new Store();
  const lead = store.lead;
  text.classList.remove('caution');
  if (lead === null) {
    text.textContent =
      'Sessions adapt to you after the first two: how long they are, how far you reach, and which finger gets extra practice.';
    return;
  }
  const settings = store.settings;
  const plan = planSession(store.sessions, lead, settings);
  if (plan.caution) {
    text.textContent = plan.caution;
    text.classList.add('caution');
  } else if (plan.reasons.length > 0) {
    text.textContent = `Your next session: ${plan.reasons.join(' ')}`;
  } else if (!settings.tailor) {
    text.textContent = 'Your next session is the standard one. Tailoring is switched off.';
  } else {
    text.textContent =
      'Your next session is the standard one. It adapts once there are two sessions to go on.';
  }
}

/** Session settings and the clear-history button. */
function setupSettings(): void {
  const tailor = document.getElementById('set-tailor') as HTMLInputElement;
  const gentle = document.getElementById('set-gentle') as HTMLInputElement;
  const bloom = document.getElementById('set-bloom') as HTMLInputElement;
  const chimes = document.getElementById('set-chimes') as HTMLInputElement;
  const reach = document.getElementById('set-reach') as HTMLInputElement;
  const message = document.getElementById('settings-message') as HTMLElement;
  const clearButton = document.getElementById('clear-history') as HTMLButtonElement;

  const load = (): void => {
    const settings = new Store().settings;
    tailor.checked = settings.tailor;
    gentle.checked = settings.gentle;
    bloom.checked = settings.leaveOut.bloom;
    chimes.checked = settings.leaveOut.chimes;
    reach.checked = settings.leaveOut.reach;
  };
  load();

  const save = (changed: HTMLInputElement): void => {
    message.textContent = '';
    if (bloom.checked && chimes.checked && reach.checked && changed !== tailor && changed !== gentle) {
      changed.checked = false;
      message.textContent = 'At least one movement stays in.';
    }
    const store = new Store();
    const settings: Settings = {
      tailor: tailor.checked,
      gentle: gentle.checked,
      leaveOut: { bloom: bloom.checked, chimes: chimes.checked, reach: reach.checked },
    };
    store.setSettings(settings);
    showNext();
  };
  for (const box of [tailor, gentle, bloom, chimes, reach]) {
    box.addEventListener('change', () => save(box));
  }

  let armed: number | null = null;
  const disarm = (): void => {
    if (armed !== null) window.clearTimeout(armed);
    armed = null;
    clearButton.textContent = 'Clear my history';
  };
  clearButton.addEventListener('click', () => {
    if (armed === null) {
      clearButton.textContent = 'Press again to clear';
      armed = window.setTimeout(disarm, 4000);
      return;
    }
    disarm();
    new Store().clear();
    showHistory();
    showNext();
  });
}

showHistory();
showNext();
setupSettings();

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
        showNext();
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
