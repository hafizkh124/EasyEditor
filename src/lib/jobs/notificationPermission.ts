/** Ask once, when the user starts a long job, so its finish can be announced in the background. */
export function askJobNotificationPermission(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
  } catch { /* unsupported */ }
}
