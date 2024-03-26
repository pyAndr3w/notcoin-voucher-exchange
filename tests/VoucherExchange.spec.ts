import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('VoucherExchange', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('VoucherExchange');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let voucherExchange: SandboxContract<VoucherExchange>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        voucherExchange = blockchain.openContract(VoucherExchange.createFromConfig({}, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await voucherExchange.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: voucherExchange.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and voucherExchange are ready to use
    });
});
