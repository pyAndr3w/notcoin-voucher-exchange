import { TonClient4 } from '@ton/ton';
import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from '@ton/core';
import { compile, NetworkProvider, UIProvider} from '@ton/blueprint';
import { promptBool, promptAmount, promptAddress, getLastBlock, waitForTransaction } from '../wrappers/ui-utils';
import { JettonWallet } from '../wrappers/JettonWallet';
import { VoucherExchange } from '../wrappers/VoucherExchange';


export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const api    = provider.api() as TonClient4;
    const sender = provider.sender();
    let minterAddress: Address; 
    let topUpAddress: Address;
    let retry:boolean;
    let amount: string;

    const depositPayload = VoucherExchange.depositJettonsMessage();

    if(sender.address === undefined) {
        throw new Error("Sender address has to be known!");
    }

    const jettonWallet = provider.open(
        JettonWallet.createFromAddress(sender.address)
    );

    do {
        retry = false;
        minterAddress = await promptAddress('Please enter minter address:', ui);
        const contractState = await api.getAccount(await getLastBlock(provider), minterAddress);
        if(contractState.account.state.type !== "active" || contractState.account.state.code == null) {
            retry = true;
            ui.write("This contract is not active!\nPlease use another address, or deploy it first");
        }
    } while(retry);

    topUpAddress = await promptAddress('Please enter top up address', ui);

    do {
        retry = false;
        amount = await promptAmount('Please provide top up amount in decimal(9) form', ui);
        ui.write(`Sending ${amount} notcoins to ${topUpAddress}`);

        retry = !(await promptBool('Is it ok?', ['yes','no'], ui));
    } while(retry);

    await jettonWallet.sendTransfer(sender, toNano('0.1') , toNano(amount), topUpAddress, sender.address, null, toNano('0.05'), depositPayload);

}
