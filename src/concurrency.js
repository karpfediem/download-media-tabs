export function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    active--;
    if (queue.length) {
      const { fn, resolve, reject } = queue.shift();
      run(fn).then(resolve, reject);
    }
  };
  const run = async (fn) => {
    active++;
    try { return await fn(); } finally { next(); }
  };
  return (fn) => new Promise((resolve, reject) => {
    if (active < concurrency) run(fn).then(resolve, reject);
    else queue.push({ fn, resolve, reject });
  });
}
