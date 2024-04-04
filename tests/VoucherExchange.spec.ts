import { Blockchain, BlockchainSnapshot, SandboxContract, SendMessageResult, TreasuryContract, internal, createShardAccount, LocalBlockchainStorage } from '@ton/sandbox';
import { Cell, Slice, toNano, Address, Transaction, beginCell, contractAddress, StateInit, storeMessage, fromNano, Dictionary, BitString, BitBuilder } from '@ton/core';
import { VoucherExchange, OP } from '../wrappers/VoucherExchange';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter, jettonContentToCell } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { Op } from '../wrappers/JettonConstants';
import { differentAddress, getContractData, getRandomInt, getRandomTon, testJettonNotification, testJettonTransfer } from './utils';
import { findTransactionRequired, randomAddress } from '@ton/test-utils';
import { computedGeneric, getMsgPrices, MsgPrices, computeMessageForwardFees, getFwdStats, computeFwdFees, collectCellStats } from './gasUtils';
import { NFTItem, NFTOps, itemConfigToCell } from '../wrappers/NFTItem';
import { aborted } from 'util';

describe('VoucherExchange', () => {
    type NftCtx = {
        index: bigint,
        address: Address,
        collection: Address,
        config: Cell
    };
    let code: Cell;
    let nftCode: Cell;
    let minterCode: Cell;
    let walletCode: Cell;

    let depositPayload: Cell;

    let blockchain: Blockchain;
    let initialState: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let jettonRoot: SandboxContract<JettonMinter>;
    let voucherExchange: SandboxContract<VoucherExchange>;
    let exchangeWallet: SandboxContract<JettonWallet>;
    let deployerWallet: SandboxContract<JettonWallet>;
    let msgPrices: MsgPrices;
    let matchingRegular: number[] = [];
    let notMatchingRegular: number[] = [];
    let matchingCats: number[]    = [];
    let notMatchingCats: number[] = [];

    const fatCats = [2 ,  263 ,  324 ,  496 , 1038, 1039, 1040, 1041, 1042 ,
                     1717 ,  2211 ,  2317 ,  2747 ,  2876 ,  3222 ,
                     3474 ,  3475 ,  3476 ,  3681 ,  3832 ,  3833 ,
                    4030 , 4986, 4987, 4988, 4989, 4990 ,  4995 ,  4996 ,  4997];

    const burnAddress = Address.parse("UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ");
    const collectionAddress = Address.parse("EQDmkj65Ab_m0aZaW8IpKw4kYqIgITw_HRstYEkVQ6NIYCyW");
    const jettonContent = jettonContentToCell({
                uri: 'https://testjetton.org',
    });

    let createNftCtx: (index: number, collection?: Address) => NftCtx;
    let deployNft: (config: Cell, collection?: Address) => Promise<SandboxContract<NFTItem>>;

    let testDeposit: (forward_amount: bigint, payload: Cell | Slice, expReturn: boolean, custom_minter?: SandboxContract<JettonMinter>) => Promise<SendMessageResult>;
    let testExchange: (nft_ctx: NftCtx, amount: bigint, expSuccess: boolean, expAmount: bigint, custom_payload?: Cell) => Promise<SendMessageResult>;

    let printTxGasStats: (name: string, trans: Transaction) => bigint;

    beforeAll(async () => {
        blockchain = await Blockchain.create();

        code = await compile('VoucherExchange');
        nftCode = Cell.fromBase64("te6ccuECDQEAAdAAABoAJAAuADwARgBQATABRgJCArgDPgN+A6ABFP8A9KQT9LzyyAsBAgFiAgMCAs4EBQAJoR+f4AUCASAGBwIBIAsMAtcMiHHAJJfA+DQ0wMBcbCSXwPg+kD6QDH6ADFx1yH6ADH6ADDwAgSzjhQwbCI0UjLHBfLhlQH6QNQwECPwA+AG0x/TP4IQX8w9FFIwuo6HMhA3XjJAE+AwNDQ1NYIQL8smohK64wJfBIQP8vCAICQARPpEMHC68uFNgAfZRNccF8uGR+kAh8AH6QNIAMfoAggr68IAboSGUUxWgod4i1wsBwwAgkgahkTbiIML/8uGSIY4+ghAFE42RyFAJzxZQC88WcSRJFFRGoHCAEMjLBVAHzxZQBfoCFctqEssfyz8ibrOUWM8XAZEy4gHJAfsAEEeUECo3W+IKAHJwghCLdxc1BcjL/1AEzxYQJIBAcIAQyMsFUAfPFlAF+gIVy2oSyx/LPyJus5RYzxcBkTLiAckB+wAAggKONSbwAYIQ1TJ22xA3RABtcXCAEMjLBVAHzxZQBfoCFctqEssfyz8ibrOUWM8XAZEy4gHJAfsAkzAyNOJVAvADADs7UTQ0z/6QCDXScIAmn8B+kDUMBAkECPgMHBZbW2AAHQDyMs/WM8WAc8WzMntVIE7pcZM=");
        minterCode = await compile('JettonMinter');
        const rawWalletCode = await compile('JettonWallet');

        blockchain.now = Math.floor(Date.now() / 1000);

        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${rawWalletCode.hash().toString('hex')}`), rawWalletCode);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;
        let lib_prep = beginCell().storeUint(2,8).storeBuffer(rawWalletCode.hash()).endCell();
        walletCode   = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});


        msgPrices  = getMsgPrices(blockchain.config, 0);

        depositPayload = VoucherExchange.depositJettonsMessage();

        deployer = await blockchain.treasury('deployer');
        jettonRoot = blockchain.openContract(JettonMinter.createFromConfig({
            admin: deployer.address,
            wallet_code: walletCode,
            jetton_content: jettonContent,
        }, minterCode ));

        voucherExchange = blockchain.openContract(VoucherExchange.createFromConfig({
            admin: deployer.address,
            jettonRoot: jettonRoot.address,
            minIdx: 1n,
            maxIdx: 10000n
        }, code, 0));


       const shardMask = (1 << 4) - 1;
       let maxCount = 0;
       const prefixMap: Map<number, number[]> = new Map();
       let matchPfx = (voucherExchange.address.hash[0] >> 4) & shardMask;
       let topPrefix: number | undefined;
       createNftCtx = (index, collection) => {
            const curColl = collection ?? collectionAddress;
            const config  = itemConfigToCell({
                index: BigInt(index),
                collection: curColl,
            });
            return {
                index: BigInt(index),
                config,
                collection: curColl,
                address: contractAddress(0, {
                    code: nftCode,
                    data: config
                })
            }
       }
       for(let catIdx of fatCats) {
           const nftAddr  = createNftCtx(catIdx).address;
           const prefix   = (nftAddr.hash[0] >> 4) & shardMask;
           const matching = prefixMap.get(prefix) ?? [];
           if(matching.length + 1 > maxCount) {
                   maxCount  = matching.length + 1;
                   topPrefix = prefix;
           }
           matching.push(catIdx);
           prefixMap.set(prefix, matching);

           if(prefix == matchPfx) {
               matchingCats.push(catIdx);
           }
           else {
               notMatchingCats.push(catIdx);
           }
        }

        let deployResult = await jettonRoot.sendDeploy(deployer.getSender(), toNano('1'));
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonRoot.address,
            deploy: true,
            success: true,
        });

        deployResult = await voucherExchange.sendDeploy(deployer.getSender(), toNano('1'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: voucherExchange.address,
            deploy: true,
            success: true
        });
        exchangeWallet = blockchain.openContract(JettonWallet.createFromAddress(
            await jettonRoot.getWalletAddress(voucherExchange.address)
        ));

        expect((await voucherExchange.getExchangeData()).wallet).toEqualAddress(exchangeWallet.address);

        if(matchingCats.length < 2) {
            console.log("No luck finding fat cats in matching shard!");
            if(topPrefix === undefined) {
                throw new Error("No luck at all!");
            }
            const smc      = await blockchain.getContract(voucherExchange.address);
            const exchData = await getContractData(voucherExchange.address, blockchain, smc);

            const ds = exchData.beginParse();
            const head = ds.loadBits(3 + 8 + 256 + 2 + 1);
            expect(ds.loadAddress()).toEqualAddress(exchangeWallet.address);

            const addrBuilder = new BitBuilder(256);
            const addrTail    = new BitString(voucherExchange.address.hash, 4, 256 - 4);
            addrBuilder.writeUint(topPrefix, 4);
            addrBuilder.writeBits(addrTail);

            const newAddr   = new Address(0, addrBuilder.buffer());
            const newWallet = await jettonRoot.getWalletAddress(newAddr);
            await blockchain.setShardAccount(newAddr, createShardAccount({
                address: newAddr,
                code,
                data: beginCell().storeBits(head).storeAddress(newWallet).storeSlice(ds).endCell(),
                balance: smc.balance
            }));
            console.log("Forced exchange into:", newAddr);
            voucherExchange = blockchain.openContract(VoucherExchange.createFromAddress(newAddr));
            expect((await voucherExchange.getExchangeData()).wallet).toEqualAddress(newWallet);
            exchangeWallet = blockchain.openContract(JettonWallet.createFromAddress(newWallet));
            console.log("Forced exchange wallet into:", newWallet);
            matchingCats = prefixMap.get(topPrefix)!;

            console.log("New matching cats:", matchingCats);

            prefixMap.delete(topPrefix);

            notMatchingCats = [...prefixMap.values()].flatMap(x => x);
        }

        let catIdx     = 1;
        let matchCount = 0;
        let missCount  = 0;

        let fatMap = new Set(fatCats);

        matchPfx   = (voucherExchange.address.hash[0] >> 4) & shardMask;

        while (matchCount < 5 || missCount < 10) {
            if(!fatMap.has(catIdx)) {
                const nftAddr = createNftCtx(catIdx).address;
                if(((nftAddr.hash[0] >> 4) & shardMask) == matchPfx) {
                    if(matchCount < 5) {
                        matchingRegular.push(catIdx);
                        matchCount++;
                    }
                }
                else if(missCount < 10) {
                    notMatchingRegular.push(catIdx);
                    missCount++;
                }
            }
            catIdx++;
        }

        deployerWallet = blockchain.openContract(JettonWallet.createFromAddress(
            await jettonRoot.getWalletAddress(deployer.address)
        ));
        // Mint some for testing purposes
        const mintAmount     = BigInt(getRandomInt(1, 5) * 1000000);
        await jettonRoot.sendMint(deployer.getSender(), deployer.address, mintAmount, deployer.address, deployer.address);
        expect(await deployerWallet.getJettonBalance()).toEqual(mintAmount);

        printTxGasStats = (name, transaction) => {
            const txComputed = computedGeneric(transaction);
            console.log(`${name} used ${txComputed.gasUsed} gas`);
            console.log(`${name} gas cost: ${txComputed.gasFees}`);
            return txComputed.gasFees;
        }

        deployNft = async (config, custom_collection) => {
            const itemAddr = contractAddress(0, {code: nftCode, data: config});
            const currColl = custom_collection ?? collectionAddress;
            const res = await blockchain.sendMessage(internal({
                from: currColl,
                to: itemAddr,
                body: beginCell().storeAddress(deployer.address).storeRef(new Cell()).endCell(),
                stateInit: {
                    code: nftCode,
                    data: config
                },
                value: toNano('1')
            }));
            expect(res.transactions).toHaveTransaction({
                on: itemAddr,
                from: currColl,
                aborted: false,
                deploy: true
            });
            return blockchain.openContract(NFTItem.createFromAddress(itemAddr));
        }

        testDeposit = async (forward_amount, payload, expReturn, custom_minter) => {
            const testAmount = BigInt(getRandomInt(1000, 2000));

            let testWallet: SandboxContract<JettonWallet>;
            let testExchangeWallet: SandboxContract<JettonWallet>;

            if(custom_minter == undefined) {
                testWallet = deployerWallet;
                testExchangeWallet = exchangeWallet;
            }
            else {
                testWallet = blockchain.openContract(JettonWallet.createFromAddress(
                    await custom_minter.getWalletAddress(deployer.address)
                ));
                testExchangeWallet = blockchain.openContract(JettonWallet.createFromAddress(
                    await custom_minter.getWalletAddress(voucherExchange.address)
                ));
            }

            const senderBalanceBefore   = await testWallet.getJettonBalance();
            const exchangeBalanceBefore = (await voucherExchange.getExchangeData()).balance;
            const exchangeWalletBalanceBefore = await testExchangeWallet.getJettonBalance();

            const res = await testWallet.sendTransfer(deployer.getSender(), toNano('1') + forward_amount, testAmount, voucherExchange.address, deployer.address, null, forward_amount, payload);
            const inTx = findTransactionRequired(res.transactions, {
                on: voucherExchange.address,
                from: testExchangeWallet.address,
                op: Op.transfer_notification,
                aborted: false,
                value: forward_amount,
                outMessagesCount: 1
            });
            if(expReturn) {
                const forwardFee = computeMessageForwardFees(msgPrices, inTx.outMessages.get(0)!);
                // Transfer back
                expect(res.transactions).toHaveTransaction({
                    on: testExchangeWallet.address,
                    from: voucherExchange.address,
                    op: Op.transfer,
                    body: (x) => testJettonTransfer(x!, {
                        amount: testAmount
                    }),
                    value: forward_amount - computedGeneric(inTx).gasFees - forwardFee.fees.total
                });
                // Should not loose any jettons
                expect(await testWallet.getJettonBalance()).toEqual(senderBalanceBefore);
                expect((await voucherExchange.getExchangeData()).balance).toEqual(exchangeBalanceBefore);
                expect(await testExchangeWallet.getJettonBalance()).toEqual(exchangeWalletBalanceBefore);
            }
            else {
                expect(exchangeBalanceBefore).toEqual(exchangeWalletBalanceBefore);
                expect(await testWallet.getJettonBalance()).toEqual(senderBalanceBefore - testAmount);
                expect((await voucherExchange.getExchangeData()).balance).toEqual(exchangeBalanceBefore + testAmount);
                expect(await testExchangeWallet.getJettonBalance()).toEqual(exchangeWalletBalanceBefore + testAmount);
            }
            return res;
        }

        testExchange = async (ctx , amount, expSuccess, expAmount, custom_payload) => {
            const nftItem = await deployNft(ctx.config, ctx.collection);
            const idx     = (await nftItem.getNFTData()).index;

            const deployerBalanceBefore = await deployerWallet.getJettonBalance();
            const exchangeBalanceBefore = (await voucherExchange.getExchangeData()).balance;
            const exchangeWalletBefore  = await exchangeWallet.getJettonBalance();
            const exchangePayload       = custom_payload ?? VoucherExchange.exchangeVoucherMessage(BigInt(idx));

            const res = await nftItem.sendTransfer(deployer.getSender(), voucherExchange.address, deployer.address, amount, exchangePayload);
            if(expSuccess) {
                expect((await nftItem.getNFTData()).owner).toEqualAddress(voucherExchange.address);
                expect((await voucherExchange.getExchangeData()).balance).toEqual(exchangeBalanceBefore - expAmount);
                expect(await exchangeWallet.getJettonBalance()).toEqual(exchangeWalletBefore - expAmount);
                expect(await deployerWallet.getJettonBalance()).toEqual(deployerBalanceBefore + expAmount);
            }
            else {
                expect((await nftItem.getNFTData()).owner).toEqualAddress(deployer.address);
                expect((await voucherExchange.getExchangeData()).balance).toEqual(exchangeBalanceBefore);
                expect(await exchangeWallet.getJettonBalance()).toEqual(exchangeWalletBefore);
                expect(await deployerWallet.getJettonBalance()).toEqual(deployerBalanceBefore);
            }
            return res;
        }
    });
    it('should deploy', async () => {
        const exchData = await voucherExchange.getExchangeData();
        expect(exchData.inited).toBe(true);
        expect(exchData.admin).toEqualAddress(deployer.address);
        expect(exchData.proposedAdmin).toBe(null);
        expect(exchData.balance).toBe(0n);
        expect(exchData.wallet).toEqualAddress(exchangeWallet.address);
        expect(exchData.min_idx).toBe(1n);
        expect(exchData.max_idx).toBe(10000n);
    });
    describe('Jetton deposits', () => {
     it('should accept jettons own wallet', async () => {
         // From 110m to 149
         const sendAmount = BigInt(getRandomInt(110, 149) * 1000000);
         const dataBefore = await voucherExchange.getExchangeData();
         const res        = await jettonRoot.sendMint(deployer.getSender(), voucherExchange.address, sendAmount, deployer.address, deployer.address, depositPayload, toNano('1'));
         const receiveTx  = findTransactionRequired(res.transactions,{
             on: voucherExchange.address,
             from: exchangeWallet.address,
             op: Op.transfer_notification,
             //body: (x) => testJettonNotification(x!, {}),
             value: toNano('1'),
             aborted: false
         });
         // Should return exceess
         expect(res.transactions).toHaveTransaction({
             from: voucherExchange.address,
             on: deployer.address,
             op: Op.excesses,
             value: toNano('1') - computedGeneric(receiveTx).gasFees - msgPrices.lumpPrice
         });
         const dataAfter = await voucherExchange.getExchangeData();
         expect(dataAfter.balance).toEqual(dataBefore.balance + sendAmount);
         printTxGasStats("Exchange jetton accept", receiveTx);
     });
     it('should handle addr_none src in transfer_notification', async () => {
         const testAmount = getRandomTon(1, 2);
         // const mintMsg    = JettonMinter.mintMessage(null, voucherExchange.address, null, testAmount, toNano('1'), depositPayload, toNano('1.1'));
         const balanceBefore = (await voucherExchange.getExchangeData()).balance;

         const prev = blockchain.snapshot();
         try {
             const res = await jettonRoot.sendMint(deployer.getSender(), voucherExchange.address, testAmount, null, deployer.address, depositPayload, toNano('1'));
             expect(res.transactions).toHaveTransaction({
                 on: voucherExchange.address,
                 from: exchangeWallet.address,
                 op: Op.transfer_notification,
                 body: (x) => testJettonNotification(x!, {
                     amount: testAmount,
                     from: null
                 }),
                 aborted: false,
                 value: toNano('1')
             });
             expect((await voucherExchange.getExchangeData()).balance).toEqual(balanceBefore + testAmount);
         }
         finally {
             await blockchain.loadFrom(prev);
         }
     });
     it('should return jettons received from other wallets', async () => {
         const prev = blockchain.snapshot();
         try {
             const testAdmin = await blockchain.treasury('random_admin');
             // Will produce different wallet
             const newJetton   = blockchain.openContract(
                 JettonMinter.createFromConfig({
                     admin: testAdmin.address,
                     jetton_content: jettonContent,
                     wallet_code: walletCode

                 }, minterCode));

             let res = await newJetton.sendDeploy(testAdmin.getSender(), toNano('1'));
             expect(res.transactions).toHaveTransaction({
                 on: newJetton.address,
                 deploy: true,
                 aborted: false
             });
             const deployerWallet = blockchain.openContract(JettonWallet.createFromAddress(
                 await newJetton.getWalletAddress(deployer.address)
             ));

             const mintAmount = getRandomTon(1, 2);
             res = await newJetton.sendMint(testAdmin.getSender(), deployer.address, mintAmount, deployer.address,deployer.address, depositPayload, toNano('1'));
             expect(await deployerWallet.getJettonBalance()).toEqual(mintAmount);
             await testDeposit(toNano('1'), depositPayload, true, newJetton);
         }
         finally {
             await blockchain.loadFrom(prev);
         }
    });
    it('should return jetton deposits with invalid payload', async () => {
        let differentOp: number;
        const validPayload = depositPayload;
        const msgVal  = toNano('1');
        const prev = blockchain.snapshot();

        const rndBits = BigInt(getRandomInt(1, 256));
        const rndPayload = beginCell().storeUint((2n ** rndBits) - 1n, Number(rndBits)).endCell();

        do {
            differentOp= getRandomInt(0, (2 ** 32) - 1);
        } while(differentOp == OP.deposit_jettons);

        const payload32 = beginCell().storeUint(differentOp, 32).endCell();

        //Prepend/append
        const prepend = beginCell().storeSlice(rndPayload.asSlice()).storeSlice(validPayload.asSlice()).endCell();
        const append  = beginCell().storeSlice(validPayload.asSlice()).storeSlice(rndPayload.asSlice()).endCell();
        const inRef   = beginCell().storeRef(validPayload).endCell();
        const inRefWithPayload = beginCell().storeSlice(rndPayload.asSlice()).storeRef(validPayload).endCell();

        try {
             for(let payload of [payload32, prepend, append, inRef, inRefWithPayload]) {
                 await testDeposit(msgVal, payload, true);
                 // Make sure either flag makes no difference
                 await testDeposit(msgVal, payload.asSlice(), true);
             }
             // Make sure valid payload succeeds as slice
             await testDeposit(msgVal, validPayload.asSlice(), false);
        }
        finally {
            await blockchain.loadFrom(prev);
        }
    });
   });
   describe('Exchange', () => {
       let prevState : BlockchainSnapshot;
       beforeAll(() => {
           prevState = blockchain.snapshot();
       });
       afterEach(async () => {
           await blockchain.loadFrom(prevState);
       });
       it('should send 100m for a large voucher', async () => {
           const expAmount = BigInt(10 ** 8);
           const nftCtx  = createNftCtx(matchingCats[getRandomInt(0, matchingCats.length - 1)]);

           const res = await testExchange(nftCtx, toNano('1'), true, expAmount);
           const voucherExTx = findTransactionRequired(res.transactions, ({
               on: voucherExchange.address,
               from: nftCtx.address,
               op: NFTOps.ownership_assigned,
               outMessagesCount: 1,
               aborted: false,
           }));
           const sendTransfer = findTransactionRequired(res.transactions, ({
               on: exchangeWallet.address,
               from: voucherExchange.address,
               op: Op.transfer,
               outMessagesCount: 1,
               aborted: false
           }));
           const receiveTransfer = findTransactionRequired(res.transactions, ({
               on: deployerWallet.address,
               from: exchangeWallet.address,
               op: Op.internal_transfer,
               aborted: false
           }));
           const fwdStats = collectCellStats(beginCell().store(storeMessage(voucherExTx.outMessages.get(0)!, {forceRef: true})).endCell(), [], true);
           // Most fat forward with state init
           console.log("Jetton transfer fwd:",fwdStats);
           printTxGasStats("Exchange voucher:", voucherExTx);
           printTxGasStats("Jetton send transfer:", sendTransfer);
           // console.log(voucherExTx.description);
           // console.log(sendTransfer.description);
           printTxGasStats("Jetton receive transfer:", receiveTransfer);
           expect(res.transactions).toHaveTransaction({
               op: Op.internal_transfer,
               from: exchangeWallet.address,
               to: deployerWallet.address,
               aborted: false,
           });
       });
       it('should send 10m for regular nft', async () => {
           const expAmount = BigInt(10 ** 7);
           const nftCtx    = createNftCtx(matchingRegular[getRandomInt(0, matchingRegular.length - 1)]);
           await testExchange(nftCtx, toNano('1'), true, expAmount);
       });
       it('exchange should work with minimal fee', async () => {
           const nftFat = createNftCtx(matchingCats[getRandomInt(0, matchingCats.length - 1)]);
           const nftReg = createNftCtx(matchingRegular[getRandomInt(0, matchingRegular.length - 1)]);

           const minFee = await voucherExchange.getExchangeFee();

           console.log("Minimal fee:", fromNano(minFee));

           for(let nftCtx of [nftFat, nftReg]) {
               let power = nftCtx == nftFat ? 8 : 7;

               const expAmount = BigInt(10 ** power);
               await testExchange(nftCtx, minFee, true, expAmount);
               await blockchain.loadFrom(prevState);
               await testExchange(nftCtx, minFee - 1n, false, expAmount);
           }
       });
       it('should return nft when index is missmatched', async () => {
           const nftFat = createNftCtx(matchingCats[getRandomInt(0, matchingCats.length - 1)]);
           const nftReg = createNftCtx(matchingRegular[getRandomInt(0, matchingRegular.length - 1)]);

           for(let nftCtx of [nftFat, nftReg]) {
               // Let's mix indexes toghether
               const mixIndex = nftCtx == nftFat ? nftReg.index : nftFat.index;
               const forwardPayload = VoucherExchange.exchangeVoucherMessage(mixIndex);
               await testExchange(nftCtx, toNano('1'), false, 0n, forwardPayload);
           }
       });
       it('should return nft when collection is missmatched', async () => {
           const wrongCollection = differentAddress(collectionAddress);
           const nftFat = createNftCtx(matchingCats[getRandomInt(0, matchingCats.length - 1)], wrongCollection);
           const nftReg = createNftCtx(matchingRegular[getRandomInt(0, matchingRegular.length - 1)], wrongCollection);

           for(let nftCtx of [nftFat, nftReg]) {
               await testExchange(nftCtx, toNano('1'), false, 0n);
           }
       });
       it('should return nft from different shard', async () => {
          const nftFat = createNftCtx(notMatchingCats[getRandomInt(0, notMatchingCats.length - 1)]);
          const nftReg = createNftCtx(notMatchingRegular[getRandomInt(0, notMatchingRegular.length - 1)]);

           for(let nftCtx of [nftFat, nftReg]) {
               await testExchange(nftCtx, toNano('1'), false, 0n);
           }
       });
       it('should return nft when there is not enough balance', async () => {
           const msgVal    = toNano('1');
           const expReg    = BigInt(10 ** 7);
           const expLarge  = expReg * 10n;
           let balanceLeft = (await voucherExchange.getExchangeData()).balance;
           let fatCount    = Number(balanceLeft / expLarge);

           for(let i = 0; i < fatCount; i++) {
               const ctx = createNftCtx(matchingCats[i]);
               await testExchange(ctx, msgVal, true, expLarge);
           }

           // Expect to fail large withdraw due to lack of balance
           balanceLeft = (await voucherExchange.getExchangeData()).balance;
           expect(balanceLeft).toBeLessThan(expLarge);

           await testExchange(createNftCtx(matchingCats[fatCount]), msgVal, false, expLarge);

           let smallCount = Number(balanceLeft / expReg);
           expect(smallCount).toBeLessThan(5);

           for(let i = 0; i < smallCount; i++) {
              const ctx = createNftCtx(matchingRegular[i]);
              await testExchange(ctx, msgVal, true, expReg);
           }
           expect((await voucherExchange.getExchangeData()).balance).toBeLessThan(expReg);
           await testExchange(createNftCtx(matchingRegular[smallCount]), msgVal, false, expReg);
       });
   });
});
