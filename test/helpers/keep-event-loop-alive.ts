export function keepEventLoopAlive(): () => void {
  const handle = setInterval(() => undefined, 60_000);
  return () => clearInterval(handle);
}
