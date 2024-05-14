import { Address } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const voucherExchangeAddress = Address.parse(await ui.input('voucher exchange address'));
    const newProposedAdmin = Address.parse(await ui.input('proposed admin address'));

    const voucherExchange = provider.open(VoucherExchange.createFromAddress(voucherExchangeAddress));
    const {admin, proposedAdmin} = await voucherExchange.getExchangeData();
    ui.write(`admin - ${admin.toString()}`)
    ui.write(`current proposed admin - ${proposedAdmin ? proposedAdmin.toString() : 'not installed'}`)

    await voucherExchange.sendChangeAdmin(provider.sender(), newProposedAdmin);

    ui.clearActionPrompt();
}
