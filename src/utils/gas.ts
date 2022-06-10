async function logGas(message: string, tx: Promise<any>, skip?: boolean): Promise<any> {
  const txResolveValue = await tx
  const txReceipt = await txResolveValue.wait()

  // some styling from http://jafrog.com/2013/11/23/colors-in-terminal.html
  if (!skip) console.log('           Used', txReceipt.gasUsed.toNumber(), `gas for \x1b[1m${message}\x1b[0m`)
  return txResolveValue
}

export { logGas }
