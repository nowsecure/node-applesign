// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = function (args: any, types: any) {
  if (args.length !== types.length) {
    throw new Error('Incorrect arguments count');
  }
  const stack = [...args].reverse();
  for (const t of types) {
    const arg = typeof stack.pop();
    if (t && arg !== t) {
      throw new Error('Invalid argument type');
    }
  }
};
