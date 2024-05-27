import { TonClient } from '@ton/ton';
import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from '@ton/core';
import { compile, sleep, NetworkProvider, UIProvider} from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import arg from 'arg';
import { NFTItem } from '../wrappers/NFTItem';

export async function run(provider: NetworkProvider, args: string[] ) {
    const collectionAddres = Address.parse("EQDmkj65Ab_m0aZaW8IpKw4kYqIgITw_HRstYEkVQ6NIYCyW");
    const sender = provider.sender();
    const api    = provider.api() as TonClient;
    const ui     = provider.ui();

    if(sender.address === undefined) {
        throw new Error("Sender address must be known!");
    }
    if(args.length < 2) {
        throw new Error("Exchange and voucher addresses are required!");
    }

    const voucherExchange = provider.open(
        VoucherExchange.createFromAddress(
            Address.parse(args[0])
    ));

    const nftItem = provider.open(NFTItem.createFromAddress(Address.parse(args[1])));
    const nftData = await nftItem.getNFTData();

    if(!nftData.inited) {
        throw new Error("This nft is not inited!");
    }
    if(!nftData.collection.equals(collectionAddres)) {
        throw new Error(`This nft is from different collection:${nftData.collection}`);
    }
    if(!nftData.owner!.equals(sender.address)) {
        throw new Error(`This voucher is owned by ${nftData.owner}`);
    }
    const transferPayload = VoucherExchange.exchangeVoucherMessage(BigInt(nftData.index));
    const nftState = await api.getContractState(nftItem.address);

    let lastLt = nftState.lastTransaction!.lt;

    await nftItem.sendTransfer(sender,
                               voucherExchange.address,
                               sender.address,
                               toNano('0.05'), 
                               transferPayload,
                               toNano('0.07'));
    let newLt = lastLt;
    let retryLeft = 60;
    do {
        await sleep(500);
        newLt = (await api.getContractState(nftItem.address)).lastTransaction!.lt;
        retryLeft--;
    } while(newLt == lastLt && retryLeft > 0);
    if(newLt == lastLt) {
        ui.write('Looks like transaction failed!');
    }
    else {
        ui.write('Done!');
    }
}
