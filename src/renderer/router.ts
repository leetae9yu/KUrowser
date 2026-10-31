import { useEffect, useState } from "react";
export type Route = { name: "today" } | { name: "settings" };

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, "").split("/")[0];
  if (name === "settings") return { name };
  return { name: "today" };
}

export function href(route: Route): string {
  return `#/${route.name}`;
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
