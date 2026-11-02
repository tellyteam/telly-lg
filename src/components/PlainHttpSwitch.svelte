<script lang="ts">
  /**
   * The "Allow plain HTTP" switch, on the sign-in form and in Settings. Turning it on takes a second
   * press, once the warning has been on screen; while it's on, the warning stays.
   */
  let { title, on, onchange, hint = "Only if your provider has no HTTPS. Your login and what you watch would be sent unencrypted." }: {
    title: string; on: boolean; onchange: (on: boolean) => void;
    /** What to say while it's off. */
    hint?: string;
  } = $props();
  let confirming = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function press() {
    clearTimeout(timer);
    if (on) { onchange(false); confirming = false; }
    else if (confirming) { onchange(true); confirming = false; }
    else { confirming = true; timer = setTimeout(() => (confirming = false), 6000); }
  }
</script>

<div class="line">
  <div>{confirming ? "Press again to allow plain HTTP" : title}<small class:warn={on || confirming}>{on || confirming ? "Not encrypted. Anyone on the same network or along the way to your provider can read your username, password and what you watch." : hint}</small></div>
  <button type="button" class="switch" class:on aria-label={title} onclick={press}></button>
</div>

<style>
  .warn { color: #ffb74d; }
</style>
