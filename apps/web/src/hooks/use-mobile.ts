import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Read through useSyncExternalStore rather than setState-in-effect, which
// Next 16's react-hooks lint rejects (and which causes a cascading render).
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

/** The server has no viewport; render the desktop layout and let the client correct it. */
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
