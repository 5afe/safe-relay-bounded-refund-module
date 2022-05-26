async function logGas(message: string, tx: Promise<any>, skip?: boolean): Promise<any> {
  const txResolveValue = await tx
  const txReceipt = txResolveValue.wait()

  if (!skip) console.log('           Used', txReceipt.gasUsed.toNumber(), `gas for >${message}<`)
  return txResolveValue
}

export { logGas }
