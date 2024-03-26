import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';

export type VoucherExchangeConfig = {};

export function voucherExchangeConfigToCell(config: VoucherExchangeConfig): Cell {
    return beginCell().endCell();
}

export class VoucherExchange implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new VoucherExchange(address);
    }

    static createFromConfig(config: VoucherExchangeConfig, code: Cell, workchain = 0) {
        const data = voucherExchangeConfigToCell(config);
        const init = { code, data };
        return new VoucherExchange(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }
}
