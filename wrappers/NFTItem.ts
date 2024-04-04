import { Address, beginCell, Cell, Slice, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';

export enum NFTOps {
    transfer = 0x5fcc3d14,
    ownership_assigned = 0x05138d91
}
export type ItemConfig = {
    index: bigint
    collection: Address,
};

export function itemConfigToCell(config: ItemConfig): Cell {
    return beginCell()
             .storeUint(config.index, 64)
             .storeAddress(config.collection)
           .endCell();
}

export class NFTItem implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NFTItem(address);
    }
    static createFromConfig(config: ItemConfig, code: Cell, workchain = 0) {
        const data = itemConfigToCell(config);
        const init = { code, data };
        return new NFTItem(contractAddress(workchain, init), init);
    }
    async sendDeploy(provider: ContractProvider, via: Sender, owner: Address, content: Cell, value: bigint = toNano('0.1'), query_id: number | bigint = 0) {
        return provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().storeUint(0, 32)
                             .storeUint(query_id, 64)
                             .storeAddress(owner)
                             .storeRef(content)
                  .endCell()
        });
    }
    async sendTransfer(provider: ContractProvider,
                       via: Sender,
                       to: Address,
                       response: Address | null,
                       forward_amount: bigint,
                       forward_payload?: Cell | Slice,
                       value: bigint = toNano('0.1'), query_id: number | bigint = 0) {
        if(forward_amount <= 0n && forward_payload !== undefined) {
            throw new Error("Forward ton amount has to be > 0 when forward payload is supplied!");
        }
        const byRef = forward_payload instanceof Cell;

        const body = beginCell().storeUint(NFTOps.transfer, 32)
                                .storeUint(query_id, 64)
                                .storeAddress(to)
                                .storeAddress(response)
                                .storeBit(false) // No custom payload
                                .storeCoins(forward_amount)
                                .storeBit(byRef)
        if(byRef) {
            body.storeRef(forward_payload);
        }
        else if(forward_payload) {
            body.storeSlice(forward_payload);
        }

        return provider.internal(via, {
            value: value + forward_amount,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: body.endCell()
        });
    }

    async getNFTData(provider: ContractProvider) {
        const { stack } = await provider.get('get_nft_data', []);
        const inited = stack.readBoolean();
        const index = stack.readNumber();
        const collection = stack.readAddress();
        const owner = stack.readAddressOpt();
        const content = stack.readCellOpt();
        return { inited, index, collection, owner, content };
    }
}
