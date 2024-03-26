import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    MessageRelaxed,
    Sender,
    SendMode, storeMessageRelaxed
} from '@ton/core';

enum OP {
    init = 0x5a6e0982,
    deposit_jettons = 0x6d8b6e80,
    send_message = 0x3df81015,
    change_admin = 0x4e9a134f,
    claim_admin = 0x56c97402,
    exchange_voucher = 0x5fec6642,
}

export type VoucherExchangeConfig = {
    admin: Address,
    jettonRoot: Address,
    map100m: Cell,
    minIdx: bigint,
    maxIdx: bigint
};

export function voucherExchangeConfigToCell(config: VoucherExchangeConfig): Cell {
    return beginCell()
          .storeAddress(config.admin)
          .storeAddress(null)
          .storeUint(0, 1)
          .storeAddress(config.jettonRoot)
          .storeCoins(0)
          .storeRef(beginCell()
                   .storeUint(1,1)
                   .storeRef(config.map100m)
                   .storeUint(config.minIdx, 64)
                   .storeUint(config.maxIdx, 64)
                   .endCell())
          .endCell();
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
            body: VoucherExchange.initMessage(0n),
        });
    }

    static initMessage(queryId: bigint) {
        return beginCell().storeUint(OP.init, 32).storeUint(queryId, 64).endCell();
    }

    static depositJettonsMessage() {
        return beginCell().storeUint(OP.deposit_jettons, 32).endCell();
    }

    static sendMessage(queryId: bigint, message: MessageRelaxed | Cell, mode: number) {
        let messageCell: Cell;

        if (message instanceof Cell) {
            messageCell = message
        } else {
            const messageBuilder = beginCell();
            messageBuilder.store(storeMessageRelaxed(message))
            messageCell = messageBuilder.endCell();
        }
        return beginCell().storeUint(OP.send_message, 32).storeUint(queryId, 64).storeRef(messageCell).storeUint(mode, 8).endCell();
    }

    static changeAdminMessage(queryId: bigint, proposedAdmin: Address | null) {
        return beginCell().storeUint(OP.change_admin, 32).storeUint(queryId, 64).storeAddress(proposedAdmin).endCell();
    }

    static claimAdminMessage(queryId: bigint) {
        return beginCell().storeUint(OP.claim_admin, 32).storeUint(queryId, 64).endCell();
    }

    static exchangeVoucherMessage(voucherIdx: bigint) {
        beginCell().storeUint(OP.exchange_voucher, 32).storeUint(voucherIdx, 64).endCell();
    }
}
