// Shared utilities used by every game
(function () {
  const W = 640,
        SS = 2,
        IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

  // Layout helper – same API as the original Boing code
  window.layout = function (cv, newH) {
    const TALL = newH >= 760,
          UI = TALL ? 1.5 : 1,
          HUD_H = TALL ? 44 : 24,
          BH = TALL ? Math.min(24, 16 + Math.round((newH - 760) / 60)) : 16,
          TOP = HUD_H + 16 + (TALL ? Math.round((newH - 480) * 0.12) : 0),
          PAD_Y = TALL ? newH - Math.max(70, Math.round(newH * 0.13)) : newH - 36;
    cv.width = W * SS;
    cv.height = newH * SS;
    const ctx = cv.getContext("2d");
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    window.__ARCADE_LAYOUT = {W, H:newH,TALL,UI,HUD_H,BH,TOP,PAD_Y,SS,IS_TOUCH};
  };

  // Pointer‑lock helper (used by Boing, Rush, etc.)
  let locked = false;
  const cv = document.getElementById("c");
  if (cv) {
    document.addEventListener("pointerlockchange", () => {
      locked = document.pointerLockElement === cv;
    });
    window.tryLock = () => {
      if (locked || !cv.requestPointerLock) return;
      try {
        const p = cv.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    };
  } else {
    window.tryLock = () => {};
  }

  // expose for games that already read these globals
  window.IS_TOUCH = IS_TOUCH;
})();
