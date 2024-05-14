import { NetworkProvider } from '@ton/blueprint';
import { Address } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const voucherExchangeAddress = Address.parse(await ui.input('voucher exchange address'));

    const voucherExchange = provider.open(VoucherExchange.createFromAddress(voucherExchangeAddress));

    const {admin, proposedAdmin} = await voucherExchange.getExchangeData();
    ui.write(`admin - ${admin.toString()}`)
    ui.write(`proposed admin - ${proposedAdmin ? proposedAdmin.toString() : 'not installed'}`)

    await voucherExchange.sendClaimAdmin(provider.sender());

    ui.clearActionPrompt();
}