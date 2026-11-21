import "./lib/polyfills";
import { mount } from "svelte";
import App from "./App.svelte";
// TVs have none of the system fonts below, so they'd fall back to the TV's own UI font.
import "@fontsource-variable/inter";
import "./app.css";
import { isTV, registerRemoteKeys } from "./lib/backend";
import { app } from "./lib/state.svelte";
import { startTv } from "./lib/tv";

// On a TV, the remote drives everything; the player handles its own keys.
if (isTV) {
  registerRemoteKeys();
  startTv(() => !!app.player);
}

export default mount(App, { target: document.getElementById("app")! });
