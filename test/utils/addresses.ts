import crypto from 'crypto'

function sortAddresses(addresses: string[]): string[] {
  return [...addresses].sort()
}

function getRandom20Bytes(): string {
  return '0x' + crypto.randomBytes(20).toString('hex')
}

function getRandomAddresses(count: number): string[] {
  const addresses = []
  for (let i = 0; i < count; i++) {
    addresses.push(getRandom20Bytes())
  }
  return addresses
}

export { sortAddresses, getRandomAddresses }
