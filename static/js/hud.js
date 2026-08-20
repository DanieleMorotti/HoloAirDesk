// Boot screen, help overlay, status bar, toasts.

export function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

export function setCheck(name, ok) {
  const li = document.querySelector(`#boot-checks li[data-check="${name}"]`);
  if (!li) return;
  li.classList.toggle("ok", ok);
  li.classList.toggle("fail", !ok);
  li.querySelector("em").textContent = ok ? "ONLINE" : "OFFLINE";
}

export function bootMessage(text) {
  document.getElementById("boot-msg").textContent = text;
}

export function finishBoot() {
  const boot = document.getElementById("boot");
  boot.classList.add("done");
  setTimeout(() => boot.remove(), 900);
  document.getElementById("sb-state").textContent = "ONLINE";
  document.getElementById("sb-state").classList.add("online");
}

export function showHelp() {
  document.getElementById("help").classList.remove("hidden");
}

export function initHud() {
  // clock
  const clock = document.getElementById("sb-clock");
  setInterval(() => { clock.textContent = new Date().toLocaleTimeString("en-GB"); }, 1000);

  document.getElementById("help-close").addEventListener("click", () => {
    document.getElementById("help").classList.add("hidden");
  });
  document.getElementById("dock-help").addEventListener("click", showHelp);
}

// status bar counters, fed from the tracking loop
let frames = 0;
setInterval(() => {
  document.getElementById("sb-fps").textContent = `${frames} FPS`;
  frames = 0;
}, 1000);

export function tickFrame(handCount) {
  frames++;
  document.getElementById("sb-hands").textContent = `HANDS ${handCount}`;
}
