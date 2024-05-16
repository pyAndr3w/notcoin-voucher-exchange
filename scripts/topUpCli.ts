import { TonClient, Address, toNano } from '@ton/ton';
import { compile, NetworkProvider, sleep, UIProvider} from '@ton/blueprint';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import { JettonWallet } from '../wrappers/JettonWallet';
import { JettonMinter } from '../wrappers/JettonMinter';


export async function run(provider: NetworkProvider, args: string[]) {
    const sender = provider.sender();
    const api    = provider.api() as TonClient;
    const ui     = provider.ui();

    if(sender.address === undefined) {
        throw new Error("Sender address must be known!");
    }
    if(args.length < 2) {
        throw new Error("Exchange and top up amount is required!");
    }
    const voucherExchange = provider.open(
        VoucherExchange.createFromAddress(
            Address.parse(args[0])
        )
    );
    const notcoinRoot = provider.open(
        JettonMinter.createFromAddress(
            Address.parse("EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT")
        )
    );
    const topUpAmount = toNano(args[1]);

    if(topUpAmount <= 0n) {
        throw new Error("Top up amount has to be > 0");
    }

    const myWallet = provider.open(
        JettonWallet.createFromAddress(
            await notcoinRoot.getWalletAddress(sender.address)
        )
    );

    const myBalance = await myWallet.getJettonBalance();
    if(myBalance < topUpAmount) {
        throw new Error("Need more gold");
    }
    ui.write(`Topping up ${voucherExchange.address} with ${topUpAmount} NOT's`);

    const payload = VoucherExchange.depositJettonsMessage();
    const jettonState = await api.getContractState(myWallet.address);

    const lastLt = jettonState.lastTransaction!.lt;
    const balanceBefore = (await voucherExchange.getExchangeData()).balance;

    await myWallet.sendTransfer(sender,
                                toNano('0.1'),
                                topUpAmount,
                                voucherExchange.address,
                                sender.address,
                                null,
                                toNano('0.05'),
                                payload);
    let newLt = lastLt;
    let retryLeft = 60;
    do {
        await sleep(500);
        newLt = (await api.getContractState(myWallet.address)).lastTransaction!.lt;
        retryLeft--;
    } while(newLt == lastLt && retryLeft > 0);
    if(newLt == lastLt) {
        ui.write('Looks like transaction failed or taking too long!');
    }
    else {
        ui.write('Done!');
        const balanceAfter = (await voucherExchange.getExchangeData()).balance;
        if(balanceAfter == balanceBefore + topUpAmount) {
            ui.write('Successfull!');
        }
        else {
            ui.write('Something went wrong!');
        }
    }
}
