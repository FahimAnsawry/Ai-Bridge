// Patches console.log/warn/error/info/debug to prepend ISO timestamps.
const original = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

function timestamp() {
  return new Date().toISOString();
}

console.log = (...args) => original.log(`[${timestamp()}]`, ...args);
console.warn = (...args) => original.warn(`[${timestamp()}]`, ...args);
console.error = (...args) => original.error(`[${timestamp()}]`, ...args);
console.info = (...args) => original.info(`[${timestamp()}]`, ...args);
console.debug = (...args) => original.debug(`[${timestamp()}]`, ...args);