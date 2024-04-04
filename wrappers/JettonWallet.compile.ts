import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    targets: ['contracts/notcoin/stdlib.fc','contracts/notcoin/op-codes.fc','contracts/notcoin/jetton-utils.fc', 'contracts/notcoin/workchain.fc', 'contracts/notcoin/jetton-wallet.fc'],
};
