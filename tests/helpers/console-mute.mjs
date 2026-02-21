export function withMutedConsole(fn) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    });
}
