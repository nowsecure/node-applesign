export default function fchk(args: any, types: any): void {
  if (args.length !== types.length) {
    throw new Error("Incorrect arguments count");
  }
  const stack = [...args].reverse();
  for (const t of types) {
    const arg = typeof stack.pop();
    if (t && arg !== t) {
      throw new Error("Invalid argument type");
    }
  }
}
