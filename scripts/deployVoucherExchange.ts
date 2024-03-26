import { toNano } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const voucherExchange = provider.open(VoucherExchange.createFromConfig({}, await compile('VoucherExchange')));

    await voucherExchange.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(voucherExchange.address);

    // run methods on `voucherExchange`
}
