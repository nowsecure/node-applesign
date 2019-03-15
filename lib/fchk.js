module.exports = function(args, types) {
  if (args.length !== types.length) {
    throw new Error('Incorrect arguments count');
  }
  const stack = args.reverse();
  for (let t of types) {
    const arg = stack.pop();
    if (t && typeof arg !== t) {
      throw new Error('Invalid argument type');
    }
  }
}
