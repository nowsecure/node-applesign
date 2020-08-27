module.exports = function (args, types) {
  if (args.length !== types.length) {
    throw new Error('Incorrect arguments count');
  }
  const stack = Array(...args).reverse();
  for (const t of types) {
    const arg = typeof stack.pop();
    if (t && arg !== t) {
      throw new Error('Invalid argument type');
    }
  }
};
