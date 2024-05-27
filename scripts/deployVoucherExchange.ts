import { Address, Cell, toNano } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import { compile, NetworkProvider } from '@ton/blueprint';
import { JettonWallet } from '../wrappers/JettonWallet';

const getShard = (address: Address): number => {
    return (address.hash[0] & 0xF0) >> 4;
}

let exchangeCode: Cell;
let walletCode: Cell;

const getVoucherExchangeByShard = (admin: Address, jettonRoot: Address, shard: number) => {
    const minIdx = 0n;
    let maxIdx = 18446744073709551615n;
    while (true) {
        const voucherExchangeContract = VoucherExchange.createFromConfig({admin, jettonRoot, maxIdx, minIdx}, exchangeCode);
        const exchangeJettonWallet = JettonWallet.createFromConfig({masterAddress: jettonRoot, ownerAddress: voucherExchangeContract.address}, walletCode);
        if ((getShard(voucherExchangeContract.address) == shard) && (getShard(exchangeJettonWallet.address) == shard)) {
            return voucherExchangeContract;
        }
        maxIdx -= 1n;
    }
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    exchangeCode = await compile('VoucherExchange');
    walletCode = Cell.fromBase64("te6ccgEBAQEAIwAIQgK6KRjIlH6bJa+awbiDNXdUFz5YEvgHo9bmQqFHCVlTlQ==");

    const notcoinRoot = Address.parse("EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT");

    const selectedShard = Number(await ui.input('shard for deploy (0-15)'))
    const admin = provider.sender().address ?? Address.parse(await ui.input('admin address'));

    ui.write('admin is ' + admin.toString())

    const voucherExchange = provider.open(getVoucherExchangeByShard(admin, notcoinRoot, selectedShard));

    await voucherExchange.sendDeploy(provider.sender(), toNano('0.1'));

    await provider.waitForDeploy(voucherExchange.address);
}
