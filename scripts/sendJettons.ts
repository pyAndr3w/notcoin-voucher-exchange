import { Address, OpenedContract, SendMode, internal, toNano } from '@ton/core';
import { VoucherExchange } from '../wrappers/VoucherExchange';
import { NetworkProvider } from '@ton/blueprint';
import { promptBool, promptAmount, promptAddress, getLastBlock, waitForTransaction } from '../wrappers/ui-utils';
import { JettonWallet } from '../wrappers/JettonWallet';

export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const sender = provider.sender();
    let exchange: OpenedContract<VoucherExchange>;
    let destination: Address;
    let amount: string;
    let amountBn: bigint;

    const interactive = args.length < 3;
    let ready         = !interactive;

    if(args.length > 0 && interactive) {
        ui.write('3 arguments required for batch mode');
        ui.write('<Exchange address> <send destination> <jetton amount>');
        ui.write(`Only ${args.length} supplied: ${args}`);
        throw new Error('Not enough arguments!');
    }

    if(sender.address === undefined) {
        throw new Error("Sender address has to be known!");
    }

    if(interactive) {
        exchange = provider.open(VoucherExchange.createFromAddress(
            await promptAddress('Please enter exchange address', ui)
        ));
        destination = await promptAddress('Please enter address to send jettons to', ui);
        amount = await promptAmount('Please enter number of jettons in decimal from', ui);
        ready  = await promptBool(`Are you sure you want to send ${amount} jettons to ${destination}`, ['Yes', 'No'], ui);
    }
    else {
        exchange = provider.open(VoucherExchange.createFromAddress(
            Address.parse(args[0])
        ));
        destination = Address.parse(args[1]);
        amount = args[2];
    }

    amountBn = toNano(amount);
    const exchData = await exchange.getExchangeData();

    if(!exchData.admin.equals(sender.address)) {
        throw new Error(`${exchData.admin} is admin at ${exchange.address} exchage!`);
    }

    const exchWallet = provider.open(JettonWallet.createFromAddress(exchData.wallet));

    if((await exchWallet.getJettonBalance()) < amountBn) {
        throw new Error(`${exchange.address} doesn't have enough jettons to send!`);
    }

    if(ready) {
        ui.write(`Sending ${amount} jettons to ${destination}`);

        await exchange.sendMessage(sender, internal({
            to: exchData.wallet,
            value: 0n,
            body: JettonWallet.transferMessage(
                amountBn,
                destination,
                sender.address,
                null,
                1n,
                null)
        }), SendMode.CARRY_ALL_REMAINING_INCOMING_VALUE, toNano('0.1'));
    }
    else {
        ui.write(`Send to ${destination} aborted!`);
    }
}
