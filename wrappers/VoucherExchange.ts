import {
    Address,
    beginCell,
    Cell,
    toNano,
    Contract,
    contractAddress,
    ContractProvider,
    MessageRelaxed,
    Sender,
    SendMode, storeMessageRelaxed
} from '@ton/core';

export enum OP {
    init = 0x5a6e0982,
    deposit_jettons = 0x6d8b6e80,
    send_message = 0x3df81015,
    change_admin = 0x548e8bfd,
    claim_admin = 0x56c97402,
    exchange_voucher = 0x5fec6642,
}

export type VoucherExchangeConfig = {
    admin: Address,
    jettonRoot: Address,
    minIdx: bigint,
    maxIdx: bigint
};

export function voucherExchangeConfigToCell(config: VoucherExchangeConfig): Cell {
    return beginCell()
          .storeAddress(config.admin)
          .storeAddress(null)
          .storeBit(false)
          .storeAddress(config.jettonRoot)
          .storeCoins(0)
          .storeRef(beginCell()
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
    static sendMessageBody(queryId: bigint, message: MessageRelaxed | Cell, mode: number) {
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
    async sendMessage(provider: ContractProvider, via: Sender, message: MessageRelaxed | Cell, mode: number, value: bigint, query_id: bigint = 0n) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: VoucherExchange.sendMessageBody(query_id, message, mode)
        });
    }

    static changeAdminMessage(queryId: bigint, proposedAdmin: Address | null) {
        return beginCell().storeUint(OP.change_admin, 32).storeUint(queryId, 64).storeAddress(proposedAdmin).endCell();
    }
    async sendChangeAdmin(provider: ContractProvider, via: Sender, proposedAdmin: Address, query_id: bigint = 0n, value: bigint = toNano('0.05')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: VoucherExchange.changeAdminMessage(query_id, proposedAdmin)
        });
    }

    static claimAdminMessage(queryId: bigint) {
        return beginCell().storeUint(OP.claim_admin, 32).storeUint(queryId, 64).endCell();
    }
    async sendClaimAdmin(provider: ContractProvider, via: Sender, query_id: bigint = 0n, value: bigint = toNano('0.05')) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: VoucherExchange.claimAdminMessage(query_id)
        });
    }

    static exchangeVoucherMessage(voucherIdx: bigint) {
        return beginCell().storeUint(OP.exchange_voucher, 32).storeUint(voucherIdx, 64).endCell();
    }

    async getExchangeData(provider: ContractProvider) {
        const { stack } = await provider.get('get_exchange_data', []);
        const admin = stack.readAddress();
        const proposedAdmin = stack.readAddressOpt();
        const isInited = stack.readBoolean();

        return {
            admin,
            proposedAdmin,
            inited: isInited,
            wallet: stack.readAddress(),
            balance: stack.readBigNumberOpt() || 0n,
            min_idx: stack.readBigNumberOpt() || 0n,
            max_idx: stack.readBigNumberOpt() || 0n
        }
    }
    async getExchangeFee(provider: ContractProvider) {
        const { stack } = await provider.get('get_exchange_fee', []);
        return stack.readBigNumber();
    }
}
