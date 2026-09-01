import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace jpt. */
export namespace jpt {

    /** Namespace base. */
    namespace base {

        /**
         * Properties of a ClientMessage.
         * @deprecated Use jpt.base.ClientMessage.$Properties instead.
         */
        interface IClientMessage extends jpt.base.ClientMessage.$Properties {
        }

        /** Represents a ClientMessage. */
        class ClientMessage {

            /**
             * Constructs a new ClientMessage.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.ClientMessage.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** ClientMessage loginRequest. */
            loginRequest?: (jpt.base.C2S_LoginRequest.$Properties|null);

            /** ClientMessage createCharacter. */
            createCharacter?: (jpt.base.C2S_CreateCharacter.$Properties|null);

            /** ClientMessage selectCharacter. */
            selectCharacter?: (jpt.base.C2S_SelectCharacter.$Properties|null);

            /** ClientMessage logout. */
            logout?: (jpt.base.C2S_Logout.$Properties|null);

            /** ClientMessage backToCharacterSelect. */
            backToCharacterSelect?: (jpt.base.C2S_BackToCharacterSelect.$Properties|null);

            /** ClientMessage playerMove. */
            playerMove?: (jpt.base.C2S_PlayerMove.$Properties|null);

            /** ClientMessage playerAction. */
            playerAction?: (jpt.base.C2S_PlayerAction.$Properties|null);

            /** ClientMessage useItem. */
            useItem?: (jpt.base.C2S_UseItem.$Properties|null);

            /** ClientMessage pickupItem. */
            pickupItem?: (jpt.base.C2S_PickupItem.$Properties|null);

            /** ClientMessage dropItem. */
            dropItem?: (jpt.base.C2S_DropItem.$Properties|null);

            /** ClientMessage attack. */
            attack?: (jpt.base.C2S_Attack.$Properties|null);

            /** ClientMessage useSkill. */
            useSkill?: (jpt.base.C2S_UseSkill.$Properties|null);

            /** ClientMessage chat. */
            chat?: (jpt.base.C2S_Chat.$Properties|null);

            /** ClientMessage tradeRequest. */
            tradeRequest?: (jpt.base.C2S_TradeRequest.$Properties|null);

            /** ClientMessage tradeAccept. */
            tradeAccept?: (jpt.base.C2S_TradeAccept.$Properties|null);

            /** ClientMessage tradeAddItem. */
            tradeAddItem?: (jpt.base.C2S_TradeAddItem.$Properties|null);

            /** ClientMessage tradeConfirm. */
            tradeConfirm?: (jpt.base.C2S_TradeConfirm.$Properties|null);

            /** ClientMessage partyInvite. */
            partyInvite?: (jpt.base.C2S_PartyInvite.$Properties|null);

            /** ClientMessage partyAccept. */
            partyAccept?: (jpt.base.C2S_PartyAccept.$Properties|null);

            /** ClientMessage partyLeave. */
            partyLeave?: (jpt.base.C2S_PartyLeave.$Properties|null);

            /** ClientMessage ping. */
            ping?: (jpt.base.C2S_Ping.$Properties|null);

            /** ClientMessage payload. */
            payload?: ("loginRequest"|"createCharacter"|"selectCharacter"|"logout"|"backToCharacterSelect"|"playerMove"|"playerAction"|"useItem"|"pickupItem"|"dropItem"|"attack"|"useSkill"|"chat"|"tradeRequest"|"tradeAccept"|"tradeAddItem"|"tradeConfirm"|"partyInvite"|"partyAccept"|"partyLeave"|"ping");

            /**
             * Creates a new ClientMessage instance using the specified properties.
             * @param [properties] Properties to set
             * @returns ClientMessage instance
             */
            static create(properties: jpt.base.ClientMessage.$Shape): jpt.base.ClientMessage & jpt.base.ClientMessage.$Shape;
            static create(properties?: jpt.base.ClientMessage.$Properties): jpt.base.ClientMessage;

            /**
             * Encodes the specified ClientMessage message. Does not implicitly {@link jpt.base.ClientMessage.verify|verify} messages.
             * @param message ClientMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.ClientMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified ClientMessage message, length delimited. Does not implicitly {@link jpt.base.ClientMessage.verify|verify} messages.
             * @param message ClientMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.ClientMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ClientMessage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.ClientMessage & jpt.base.ClientMessage.$Shape} ClientMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.ClientMessage & jpt.base.ClientMessage.$Shape;

            /**
             * Decodes a ClientMessage message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.ClientMessage & jpt.base.ClientMessage.$Shape} ClientMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.ClientMessage & jpt.base.ClientMessage.$Shape;

            /**
             * Verifies a ClientMessage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a ClientMessage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ClientMessage
             */
            static fromObject(object: { [k: string]: any }): jpt.base.ClientMessage;

            /**
             * Creates a plain object from a ClientMessage message. Also converts values to other types if specified.
             * @param message ClientMessage
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.ClientMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ClientMessage to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for ClientMessage
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace ClientMessage {

            /** Properties of a ClientMessage. */
            interface $Properties {

                /** ClientMessage loginRequest */
                loginRequest?: (jpt.base.C2S_LoginRequest.$Properties|null);

                /** ClientMessage createCharacter */
                createCharacter?: (jpt.base.C2S_CreateCharacter.$Properties|null);

                /** ClientMessage selectCharacter */
                selectCharacter?: (jpt.base.C2S_SelectCharacter.$Properties|null);

                /** ClientMessage logout */
                logout?: (jpt.base.C2S_Logout.$Properties|null);

                /** ClientMessage backToCharacterSelect */
                backToCharacterSelect?: (jpt.base.C2S_BackToCharacterSelect.$Properties|null);

                /** ClientMessage playerMove */
                playerMove?: (jpt.base.C2S_PlayerMove.$Properties|null);

                /** ClientMessage playerAction */
                playerAction?: (jpt.base.C2S_PlayerAction.$Properties|null);

                /** ClientMessage useItem */
                useItem?: (jpt.base.C2S_UseItem.$Properties|null);

                /** ClientMessage pickupItem */
                pickupItem?: (jpt.base.C2S_PickupItem.$Properties|null);

                /** ClientMessage dropItem */
                dropItem?: (jpt.base.C2S_DropItem.$Properties|null);

                /** ClientMessage attack */
                attack?: (jpt.base.C2S_Attack.$Properties|null);

                /** ClientMessage useSkill */
                useSkill?: (jpt.base.C2S_UseSkill.$Properties|null);

                /** ClientMessage chat */
                chat?: (jpt.base.C2S_Chat.$Properties|null);

                /** ClientMessage tradeRequest */
                tradeRequest?: (jpt.base.C2S_TradeRequest.$Properties|null);

                /** ClientMessage tradeAccept */
                tradeAccept?: (jpt.base.C2S_TradeAccept.$Properties|null);

                /** ClientMessage tradeAddItem */
                tradeAddItem?: (jpt.base.C2S_TradeAddItem.$Properties|null);

                /** ClientMessage tradeConfirm */
                tradeConfirm?: (jpt.base.C2S_TradeConfirm.$Properties|null);

                /** ClientMessage partyInvite */
                partyInvite?: (jpt.base.C2S_PartyInvite.$Properties|null);

                /** ClientMessage partyAccept */
                partyAccept?: (jpt.base.C2S_PartyAccept.$Properties|null);

                /** ClientMessage partyLeave */
                partyLeave?: (jpt.base.C2S_PartyLeave.$Properties|null);

                /** ClientMessage ping */
                ping?: (jpt.base.C2S_Ping.$Properties|null);

                /** ClientMessage payload */
                payload?: ("loginRequest"|"createCharacter"|"selectCharacter"|"logout"|"backToCharacterSelect"|"playerMove"|"playerAction"|"useItem"|"pickupItem"|"dropItem"|"attack"|"useSkill"|"chat"|"tradeRequest"|"tradeAccept"|"tradeAddItem"|"tradeConfirm"|"partyInvite"|"partyAccept"|"partyLeave"|"ping");

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Narrowed shape of a ClientMessage. */
            type $Shape = {
              loginRequest?: jpt.base.C2S_LoginRequest.$Shape|null;
              createCharacter?: jpt.base.C2S_CreateCharacter.$Shape|null;
              selectCharacter?: jpt.base.C2S_SelectCharacter.$Shape|null;
              logout?: jpt.base.C2S_Logout.$Shape|null;
              backToCharacterSelect?: jpt.base.C2S_BackToCharacterSelect.$Shape|null;
              playerMove?: jpt.base.C2S_PlayerMove.$Shape|null;
              playerAction?: jpt.base.C2S_PlayerAction.$Shape|null;
              useItem?: jpt.base.C2S_UseItem.$Shape|null;
              pickupItem?: jpt.base.C2S_PickupItem.$Shape|null;
              dropItem?: jpt.base.C2S_DropItem.$Shape|null;
              attack?: jpt.base.C2S_Attack.$Shape|null;
              useSkill?: jpt.base.C2S_UseSkill.$Shape|null;
              chat?: jpt.base.C2S_Chat.$Shape|null;
              tradeRequest?: jpt.base.C2S_TradeRequest.$Shape|null;
              tradeAccept?: jpt.base.C2S_TradeAccept.$Shape|null;
              tradeAddItem?: jpt.base.C2S_TradeAddItem.$Shape|null;
              tradeConfirm?: jpt.base.C2S_TradeConfirm.$Shape|null;
              partyInvite?: jpt.base.C2S_PartyInvite.$Shape|null;
              partyAccept?: jpt.base.C2S_PartyAccept.$Shape|null;
              partyLeave?: jpt.base.C2S_PartyLeave.$Shape|null;
              ping?: jpt.base.C2S_Ping.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ payload?: undefined; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "loginRequest"; loginRequest: jpt.base.C2S_LoginRequest.$Shape; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "createCharacter"; loginRequest?: null; createCharacter: jpt.base.C2S_CreateCharacter.$Shape; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "selectCharacter"; loginRequest?: null; createCharacter?: null; selectCharacter: jpt.base.C2S_SelectCharacter.$Shape; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "logout"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout: jpt.base.C2S_Logout.$Shape; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "backToCharacterSelect"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect: jpt.base.C2S_BackToCharacterSelect.$Shape; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "playerMove"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove: jpt.base.C2S_PlayerMove.$Shape; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "playerAction"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction: jpt.base.C2S_PlayerAction.$Shape; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "useItem"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem: jpt.base.C2S_UseItem.$Shape; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "pickupItem"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem: jpt.base.C2S_PickupItem.$Shape; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "dropItem"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem: jpt.base.C2S_DropItem.$Shape; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "attack"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack: jpt.base.C2S_Attack.$Shape; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "useSkill"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill: jpt.base.C2S_UseSkill.$Shape; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "chat"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat: jpt.base.C2S_Chat.$Shape; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "tradeRequest"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest: jpt.base.C2S_TradeRequest.$Shape; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "tradeAccept"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept: jpt.base.C2S_TradeAccept.$Shape; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "tradeAddItem"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem: jpt.base.C2S_TradeAddItem.$Shape; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "tradeConfirm"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm: jpt.base.C2S_TradeConfirm.$Shape; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "partyInvite"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite: jpt.base.C2S_PartyInvite.$Shape; partyAccept?: null; partyLeave?: null; ping?: null }|{ payload?: "partyAccept"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept: jpt.base.C2S_PartyAccept.$Shape; partyLeave?: null; ping?: null }|{ payload?: "partyLeave"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave: jpt.base.C2S_PartyLeave.$Shape; ping?: null }|{ payload?: "ping"; loginRequest?: null; createCharacter?: null; selectCharacter?: null; logout?: null; backToCharacterSelect?: null; playerMove?: null; playerAction?: null; useItem?: null; pickupItem?: null; dropItem?: null; attack?: null; useSkill?: null; chat?: null; tradeRequest?: null; tradeAccept?: null; tradeAddItem?: null; tradeConfirm?: null; partyInvite?: null; partyAccept?: null; partyLeave?: null; ping: jpt.base.C2S_Ping.$Shape })
            );
        }

        /**
         * Properties of a ServerMessage.
         * @deprecated Use jpt.base.ServerMessage.$Properties instead.
         */
        interface IServerMessage extends jpt.base.ServerMessage.$Properties {
        }

        /** Represents a ServerMessage. */
        class ServerMessage {

            /**
             * Constructs a new ServerMessage.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.ServerMessage.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** ServerMessage loginResponse. */
            loginResponse?: (jpt.base.S2C_LoginResponse.$Properties|null);

            /** ServerMessage characterList. */
            characterList?: (jpt.base.S2C_CharacterList.$Properties|null);

            /** ServerMessage createCharacterResult. */
            createCharacterResult?: (jpt.base.S2C_CreateCharacterResult.$Properties|null);

            /** ServerMessage playerAppear. */
            playerAppear?: (jpt.base.S2C_PlayerAppear.$Properties|null);

            /** ServerMessage playerDisappear. */
            playerDisappear?: (jpt.base.S2C_PlayerDisappear.$Properties|null);

            /** ServerMessage playerMove. */
            playerMove?: (jpt.base.S2C_PlayerMove.$Properties|null);

            /** ServerMessage playerState. */
            playerState?: (jpt.base.S2C_PlayerState.$Properties|null);

            /** ServerMessage playerDeath. */
            playerDeath?: (jpt.base.S2C_PlayerDeath.$Properties|null);

            /** ServerMessage playerRespawn. */
            playerRespawn?: (jpt.base.S2C_PlayerRespawn.$Properties|null);

            /** ServerMessage monsterAppear. */
            monsterAppear?: (jpt.base.S2C_MonsterAppear.$Properties|null);

            /** ServerMessage monsterDisappear. */
            monsterDisappear?: (jpt.base.S2C_MonsterDisappear.$Properties|null);

            /** ServerMessage monsterMove. */
            monsterMove?: (jpt.base.S2C_MonsterMove.$Properties|null);

            /** ServerMessage monsterState. */
            monsterState?: (jpt.base.S2C_MonsterState.$Properties|null);

            /** ServerMessage monsterDeath. */
            monsterDeath?: (jpt.base.S2C_MonsterDeath.$Properties|null);

            /** ServerMessage attackResult. */
            attackResult?: (jpt.base.S2C_AttackResult.$Properties|null);

            /** ServerMessage skillAttack. */
            skillAttack?: (jpt.base.S2C_SkillAttack.$Properties|null);

            /** ServerMessage aoeAttack. */
            aoeAttack?: (jpt.base.S2C_AoeAttack.$Properties|null);

            /** ServerMessage damage. */
            damage?: (jpt.base.S2C_Damage.$Properties|null);

            /** ServerMessage heal. */
            heal?: (jpt.base.S2C_Heal.$Properties|null);

            /** ServerMessage buffApply. */
            buffApply?: (jpt.base.S2C_BuffApply.$Properties|null);

            /** ServerMessage buffRemove. */
            buffRemove?: (jpt.base.S2C_BuffRemove.$Properties|null);

            /** ServerMessage itemAdd. */
            itemAdd?: (jpt.base.S2C_ItemAdd.$Properties|null);

            /** ServerMessage itemRemove. */
            itemRemove?: (jpt.base.S2C_ItemRemove.$Properties|null);

            /** ServerMessage itemUse. */
            itemUse?: (jpt.base.S2C_ItemUse.$Properties|null);

            /** ServerMessage goldChange. */
            goldChange?: (jpt.base.S2C_GoldChange.$Properties|null);

            /** ServerMessage groundItemAppear. */
            groundItemAppear?: (jpt.base.S2C_GroundItemAppear.$Properties|null);

            /** ServerMessage groundItemDisappear. */
            groundItemDisappear?: (jpt.base.S2C_GroundItemDisappear.$Properties|null);

            /** ServerMessage chat. */
            chat?: (jpt.base.S2C_Chat.$Properties|null);

            /** ServerMessage tradeRequest. */
            tradeRequest?: (jpt.base.S2C_TradeRequest.$Properties|null);

            /** ServerMessage tradeOpen. */
            tradeOpen?: (jpt.base.S2C_TradeOpen.$Properties|null);

            /** ServerMessage tradeUpdate. */
            tradeUpdate?: (jpt.base.S2C_TradeUpdate.$Properties|null);

            /** ServerMessage tradeComplete. */
            tradeComplete?: (jpt.base.S2C_TradeComplete.$Properties|null);

            /** ServerMessage partyUpdate. */
            partyUpdate?: (jpt.base.S2C_PartyUpdate.$Properties|null);

            /** ServerMessage partyInvite. */
            partyInvite?: (jpt.base.S2C_PartyInvite.$Properties|null);

            /** ServerMessage pong. */
            pong?: (jpt.base.S2C_Pong.$Properties|null);

            /** ServerMessage error. */
            error?: (jpt.base.S2C_Error.$Properties|null);

            /** ServerMessage systemMessage. */
            systemMessage?: (jpt.base.S2C_SystemMessage.$Properties|null);

            /** ServerMessage disconnect. */
            disconnect?: (jpt.base.S2C_Disconnect.$Properties|null);

            /** ServerMessage payload. */
            payload?: ("loginResponse"|"characterList"|"createCharacterResult"|"playerAppear"|"playerDisappear"|"playerMove"|"playerState"|"playerDeath"|"playerRespawn"|"monsterAppear"|"monsterDisappear"|"monsterMove"|"monsterState"|"monsterDeath"|"attackResult"|"skillAttack"|"aoeAttack"|"damage"|"heal"|"buffApply"|"buffRemove"|"itemAdd"|"itemRemove"|"itemUse"|"goldChange"|"groundItemAppear"|"groundItemDisappear"|"chat"|"tradeRequest"|"tradeOpen"|"tradeUpdate"|"tradeComplete"|"partyUpdate"|"partyInvite"|"pong"|"error"|"systemMessage"|"disconnect");

            /**
             * Creates a new ServerMessage instance using the specified properties.
             * @param [properties] Properties to set
             * @returns ServerMessage instance
             */
            static create(properties: jpt.base.ServerMessage.$Shape): jpt.base.ServerMessage & jpt.base.ServerMessage.$Shape;
            static create(properties?: jpt.base.ServerMessage.$Properties): jpt.base.ServerMessage;

            /**
             * Encodes the specified ServerMessage message. Does not implicitly {@link jpt.base.ServerMessage.verify|verify} messages.
             * @param message ServerMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.ServerMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified ServerMessage message, length delimited. Does not implicitly {@link jpt.base.ServerMessage.verify|verify} messages.
             * @param message ServerMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.ServerMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ServerMessage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.ServerMessage & jpt.base.ServerMessage.$Shape} ServerMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.ServerMessage & jpt.base.ServerMessage.$Shape;

            /**
             * Decodes a ServerMessage message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.ServerMessage & jpt.base.ServerMessage.$Shape} ServerMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.ServerMessage & jpt.base.ServerMessage.$Shape;

            /**
             * Verifies a ServerMessage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a ServerMessage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ServerMessage
             */
            static fromObject(object: { [k: string]: any }): jpt.base.ServerMessage;

            /**
             * Creates a plain object from a ServerMessage message. Also converts values to other types if specified.
             * @param message ServerMessage
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.ServerMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ServerMessage to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for ServerMessage
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace ServerMessage {

            /** Properties of a ServerMessage. */
            interface $Properties {

                /** ServerMessage loginResponse */
                loginResponse?: (jpt.base.S2C_LoginResponse.$Properties|null);

                /** ServerMessage characterList */
                characterList?: (jpt.base.S2C_CharacterList.$Properties|null);

                /** ServerMessage createCharacterResult */
                createCharacterResult?: (jpt.base.S2C_CreateCharacterResult.$Properties|null);

                /** ServerMessage playerAppear */
                playerAppear?: (jpt.base.S2C_PlayerAppear.$Properties|null);

                /** ServerMessage playerDisappear */
                playerDisappear?: (jpt.base.S2C_PlayerDisappear.$Properties|null);

                /** ServerMessage playerMove */
                playerMove?: (jpt.base.S2C_PlayerMove.$Properties|null);

                /** ServerMessage playerState */
                playerState?: (jpt.base.S2C_PlayerState.$Properties|null);

                /** ServerMessage playerDeath */
                playerDeath?: (jpt.base.S2C_PlayerDeath.$Properties|null);

                /** ServerMessage playerRespawn */
                playerRespawn?: (jpt.base.S2C_PlayerRespawn.$Properties|null);

                /** ServerMessage monsterAppear */
                monsterAppear?: (jpt.base.S2C_MonsterAppear.$Properties|null);

                /** ServerMessage monsterDisappear */
                monsterDisappear?: (jpt.base.S2C_MonsterDisappear.$Properties|null);

                /** ServerMessage monsterMove */
                monsterMove?: (jpt.base.S2C_MonsterMove.$Properties|null);

                /** ServerMessage monsterState */
                monsterState?: (jpt.base.S2C_MonsterState.$Properties|null);

                /** ServerMessage monsterDeath */
                monsterDeath?: (jpt.base.S2C_MonsterDeath.$Properties|null);

                /** ServerMessage attackResult */
                attackResult?: (jpt.base.S2C_AttackResult.$Properties|null);

                /** ServerMessage skillAttack */
                skillAttack?: (jpt.base.S2C_SkillAttack.$Properties|null);

                /** ServerMessage aoeAttack */
                aoeAttack?: (jpt.base.S2C_AoeAttack.$Properties|null);

                /** ServerMessage damage */
                damage?: (jpt.base.S2C_Damage.$Properties|null);

                /** ServerMessage heal */
                heal?: (jpt.base.S2C_Heal.$Properties|null);

                /** ServerMessage buffApply */
                buffApply?: (jpt.base.S2C_BuffApply.$Properties|null);

                /** ServerMessage buffRemove */
                buffRemove?: (jpt.base.S2C_BuffRemove.$Properties|null);

                /** ServerMessage itemAdd */
                itemAdd?: (jpt.base.S2C_ItemAdd.$Properties|null);

                /** ServerMessage itemRemove */
                itemRemove?: (jpt.base.S2C_ItemRemove.$Properties|null);

                /** ServerMessage itemUse */
                itemUse?: (jpt.base.S2C_ItemUse.$Properties|null);

                /** ServerMessage goldChange */
                goldChange?: (jpt.base.S2C_GoldChange.$Properties|null);

                /** ServerMessage groundItemAppear */
                groundItemAppear?: (jpt.base.S2C_GroundItemAppear.$Properties|null);

                /** ServerMessage groundItemDisappear */
                groundItemDisappear?: (jpt.base.S2C_GroundItemDisappear.$Properties|null);

                /** ServerMessage chat */
                chat?: (jpt.base.S2C_Chat.$Properties|null);

                /** ServerMessage tradeRequest */
                tradeRequest?: (jpt.base.S2C_TradeRequest.$Properties|null);

                /** ServerMessage tradeOpen */
                tradeOpen?: (jpt.base.S2C_TradeOpen.$Properties|null);

                /** ServerMessage tradeUpdate */
                tradeUpdate?: (jpt.base.S2C_TradeUpdate.$Properties|null);

                /** ServerMessage tradeComplete */
                tradeComplete?: (jpt.base.S2C_TradeComplete.$Properties|null);

                /** ServerMessage partyUpdate */
                partyUpdate?: (jpt.base.S2C_PartyUpdate.$Properties|null);

                /** ServerMessage partyInvite */
                partyInvite?: (jpt.base.S2C_PartyInvite.$Properties|null);

                /** ServerMessage pong */
                pong?: (jpt.base.S2C_Pong.$Properties|null);

                /** ServerMessage error */
                error?: (jpt.base.S2C_Error.$Properties|null);

                /** ServerMessage systemMessage */
                systemMessage?: (jpt.base.S2C_SystemMessage.$Properties|null);

                /** ServerMessage disconnect */
                disconnect?: (jpt.base.S2C_Disconnect.$Properties|null);

                /** ServerMessage payload */
                payload?: ("loginResponse"|"characterList"|"createCharacterResult"|"playerAppear"|"playerDisappear"|"playerMove"|"playerState"|"playerDeath"|"playerRespawn"|"monsterAppear"|"monsterDisappear"|"monsterMove"|"monsterState"|"monsterDeath"|"attackResult"|"skillAttack"|"aoeAttack"|"damage"|"heal"|"buffApply"|"buffRemove"|"itemAdd"|"itemRemove"|"itemUse"|"goldChange"|"groundItemAppear"|"groundItemDisappear"|"chat"|"tradeRequest"|"tradeOpen"|"tradeUpdate"|"tradeComplete"|"partyUpdate"|"partyInvite"|"pong"|"error"|"systemMessage"|"disconnect");

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Narrowed shape of a ServerMessage. */
            type $Shape = {
              loginResponse?: jpt.base.S2C_LoginResponse.$Shape|null;
              characterList?: jpt.base.S2C_CharacterList.$Shape|null;
              createCharacterResult?: jpt.base.S2C_CreateCharacterResult.$Shape|null;
              playerAppear?: jpt.base.S2C_PlayerAppear.$Shape|null;
              playerDisappear?: jpt.base.S2C_PlayerDisappear.$Shape|null;
              playerMove?: jpt.base.S2C_PlayerMove.$Shape|null;
              playerState?: jpt.base.S2C_PlayerState.$Shape|null;
              playerDeath?: jpt.base.S2C_PlayerDeath.$Shape|null;
              playerRespawn?: jpt.base.S2C_PlayerRespawn.$Shape|null;
              monsterAppear?: jpt.base.S2C_MonsterAppear.$Shape|null;
              monsterDisappear?: jpt.base.S2C_MonsterDisappear.$Shape|null;
              monsterMove?: jpt.base.S2C_MonsterMove.$Shape|null;
              monsterState?: jpt.base.S2C_MonsterState.$Shape|null;
              monsterDeath?: jpt.base.S2C_MonsterDeath.$Shape|null;
              attackResult?: jpt.base.S2C_AttackResult.$Shape|null;
              skillAttack?: jpt.base.S2C_SkillAttack.$Shape|null;
              aoeAttack?: jpt.base.S2C_AoeAttack.$Shape|null;
              damage?: jpt.base.S2C_Damage.$Shape|null;
              heal?: jpt.base.S2C_Heal.$Shape|null;
              buffApply?: jpt.base.S2C_BuffApply.$Shape|null;
              buffRemove?: jpt.base.S2C_BuffRemove.$Shape|null;
              itemAdd?: jpt.base.S2C_ItemAdd.$Shape|null;
              itemRemove?: jpt.base.S2C_ItemRemove.$Shape|null;
              itemUse?: jpt.base.S2C_ItemUse.$Shape|null;
              goldChange?: jpt.base.S2C_GoldChange.$Shape|null;
              groundItemAppear?: jpt.base.S2C_GroundItemAppear.$Shape|null;
              groundItemDisappear?: jpt.base.S2C_GroundItemDisappear.$Shape|null;
              chat?: jpt.base.S2C_Chat.$Shape|null;
              tradeRequest?: jpt.base.S2C_TradeRequest.$Shape|null;
              tradeOpen?: jpt.base.S2C_TradeOpen.$Shape|null;
              tradeUpdate?: jpt.base.S2C_TradeUpdate.$Shape|null;
              tradeComplete?: jpt.base.S2C_TradeComplete.$Shape|null;
              partyUpdate?: jpt.base.S2C_PartyUpdate.$Shape|null;
              partyInvite?: jpt.base.S2C_PartyInvite.$Shape|null;
              pong?: jpt.base.S2C_Pong.$Shape|null;
              error?: jpt.base.S2C_Error.$Shape|null;
              systemMessage?: jpt.base.S2C_SystemMessage.$Shape|null;
              disconnect?: jpt.base.S2C_Disconnect.$Shape|null;
              $unknowns?: Uint8Array[];
            } & (
              ({ payload?: undefined; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "loginResponse"; loginResponse: jpt.base.S2C_LoginResponse.$Shape; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "characterList"; loginResponse?: null; characterList: jpt.base.S2C_CharacterList.$Shape; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "createCharacterResult"; loginResponse?: null; characterList?: null; createCharacterResult: jpt.base.S2C_CreateCharacterResult.$Shape; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerAppear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear: jpt.base.S2C_PlayerAppear.$Shape; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerDisappear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear: jpt.base.S2C_PlayerDisappear.$Shape; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerMove"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove: jpt.base.S2C_PlayerMove.$Shape; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerState"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState: jpt.base.S2C_PlayerState.$Shape; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerDeath"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath: jpt.base.S2C_PlayerDeath.$Shape; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "playerRespawn"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn: jpt.base.S2C_PlayerRespawn.$Shape; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "monsterAppear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear: jpt.base.S2C_MonsterAppear.$Shape; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "monsterDisappear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear: jpt.base.S2C_MonsterDisappear.$Shape; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "monsterMove"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove: jpt.base.S2C_MonsterMove.$Shape; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "monsterState"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState: jpt.base.S2C_MonsterState.$Shape; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "monsterDeath"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath: jpt.base.S2C_MonsterDeath.$Shape; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "attackResult"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult: jpt.base.S2C_AttackResult.$Shape; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "skillAttack"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack: jpt.base.S2C_SkillAttack.$Shape; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "aoeAttack"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack: jpt.base.S2C_AoeAttack.$Shape; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "damage"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage: jpt.base.S2C_Damage.$Shape; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "heal"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal: jpt.base.S2C_Heal.$Shape; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "buffApply"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply: jpt.base.S2C_BuffApply.$Shape; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "buffRemove"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove: jpt.base.S2C_BuffRemove.$Shape; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "itemAdd"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd: jpt.base.S2C_ItemAdd.$Shape; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "itemRemove"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove: jpt.base.S2C_ItemRemove.$Shape; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "itemUse"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse: jpt.base.S2C_ItemUse.$Shape; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "goldChange"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange: jpt.base.S2C_GoldChange.$Shape; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "groundItemAppear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear: jpt.base.S2C_GroundItemAppear.$Shape; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "groundItemDisappear"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear: jpt.base.S2C_GroundItemDisappear.$Shape; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "chat"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat: jpt.base.S2C_Chat.$Shape; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "tradeRequest"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest: jpt.base.S2C_TradeRequest.$Shape; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "tradeOpen"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen: jpt.base.S2C_TradeOpen.$Shape; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "tradeUpdate"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate: jpt.base.S2C_TradeUpdate.$Shape; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "tradeComplete"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete: jpt.base.S2C_TradeComplete.$Shape; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "partyUpdate"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate: jpt.base.S2C_PartyUpdate.$Shape; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "partyInvite"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite: jpt.base.S2C_PartyInvite.$Shape; pong?: null; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "pong"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong: jpt.base.S2C_Pong.$Shape; error?: null; systemMessage?: null; disconnect?: null }|{ payload?: "error"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error: jpt.base.S2C_Error.$Shape; systemMessage?: null; disconnect?: null }|{ payload?: "systemMessage"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage: jpt.base.S2C_SystemMessage.$Shape; disconnect?: null }|{ payload?: "disconnect"; loginResponse?: null; characterList?: null; createCharacterResult?: null; playerAppear?: null; playerDisappear?: null; playerMove?: null; playerState?: null; playerDeath?: null; playerRespawn?: null; monsterAppear?: null; monsterDisappear?: null; monsterMove?: null; monsterState?: null; monsterDeath?: null; attackResult?: null; skillAttack?: null; aoeAttack?: null; damage?: null; heal?: null; buffApply?: null; buffRemove?: null; itemAdd?: null; itemRemove?: null; itemUse?: null; goldChange?: null; groundItemAppear?: null; groundItemDisappear?: null; chat?: null; tradeRequest?: null; tradeOpen?: null; tradeUpdate?: null; tradeComplete?: null; partyUpdate?: null; partyInvite?: null; pong?: null; error?: null; systemMessage?: null; disconnect: jpt.base.S2C_Disconnect.$Shape })
            );
        }

        /**
         * Properties of a C2S_LoginRequest.
         * @deprecated Use jpt.base.C2S_LoginRequest.$Properties instead.
         */
        interface IC2S_LoginRequest extends jpt.base.C2S_LoginRequest.$Properties {
        }

        /** Represents a C2S_LoginRequest. */
        class C2S_LoginRequest {

            /**
             * Constructs a new C2S_LoginRequest.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_LoginRequest.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_LoginRequest username. */
            username: string;

            /** C2S_LoginRequest password. */
            password: string;

            /** C2S_LoginRequest clientVersion. */
            clientVersion: string;

            /**
             * Creates a new C2S_LoginRequest instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_LoginRequest instance
             */
            static create(properties: jpt.base.C2S_LoginRequest.$Shape): jpt.base.C2S_LoginRequest & jpt.base.C2S_LoginRequest.$Shape;
            static create(properties?: jpt.base.C2S_LoginRequest.$Properties): jpt.base.C2S_LoginRequest;

            /**
             * Encodes the specified C2S_LoginRequest message. Does not implicitly {@link jpt.base.C2S_LoginRequest.verify|verify} messages.
             * @param message C2S_LoginRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_LoginRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_LoginRequest message, length delimited. Does not implicitly {@link jpt.base.C2S_LoginRequest.verify|verify} messages.
             * @param message C2S_LoginRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_LoginRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_LoginRequest message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_LoginRequest & jpt.base.C2S_LoginRequest.$Shape} C2S_LoginRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_LoginRequest & jpt.base.C2S_LoginRequest.$Shape;

            /**
             * Decodes a C2S_LoginRequest message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_LoginRequest & jpt.base.C2S_LoginRequest.$Shape} C2S_LoginRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_LoginRequest & jpt.base.C2S_LoginRequest.$Shape;

            /**
             * Verifies a C2S_LoginRequest message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_LoginRequest message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_LoginRequest
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_LoginRequest;

            /**
             * Creates a plain object from a C2S_LoginRequest message. Also converts values to other types if specified.
             * @param message C2S_LoginRequest
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_LoginRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_LoginRequest to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_LoginRequest
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_LoginRequest {

            /** Properties of a C2S_LoginRequest. */
            interface $Properties {

                /** C2S_LoginRequest username */
                username?: (string|null);

                /** C2S_LoginRequest password */
                password?: (string|null);

                /** C2S_LoginRequest clientVersion */
                clientVersion?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_LoginRequest. */
            type $Shape = jpt.base.C2S_LoginRequest.$Properties;
        }

        /**
         * Properties of a C2S_CreateCharacter.
         * @deprecated Use jpt.base.C2S_CreateCharacter.$Properties instead.
         */
        interface IC2S_CreateCharacter extends jpt.base.C2S_CreateCharacter.$Properties {
        }

        /** Represents a C2S_CreateCharacter. */
        class C2S_CreateCharacter {

            /**
             * Constructs a new C2S_CreateCharacter.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_CreateCharacter.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_CreateCharacter name. */
            name: string;

            /** C2S_CreateCharacter classId. */
            classId: number;

            /** C2S_CreateCharacter head. */
            head: number;

            /**
             * Creates a new C2S_CreateCharacter instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_CreateCharacter instance
             */
            static create(properties: jpt.base.C2S_CreateCharacter.$Shape): jpt.base.C2S_CreateCharacter & jpt.base.C2S_CreateCharacter.$Shape;
            static create(properties?: jpt.base.C2S_CreateCharacter.$Properties): jpt.base.C2S_CreateCharacter;

            /**
             * Encodes the specified C2S_CreateCharacter message. Does not implicitly {@link jpt.base.C2S_CreateCharacter.verify|verify} messages.
             * @param message C2S_CreateCharacter message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_CreateCharacter.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_CreateCharacter message, length delimited. Does not implicitly {@link jpt.base.C2S_CreateCharacter.verify|verify} messages.
             * @param message C2S_CreateCharacter message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_CreateCharacter.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_CreateCharacter message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_CreateCharacter & jpt.base.C2S_CreateCharacter.$Shape} C2S_CreateCharacter
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_CreateCharacter & jpt.base.C2S_CreateCharacter.$Shape;

            /**
             * Decodes a C2S_CreateCharacter message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_CreateCharacter & jpt.base.C2S_CreateCharacter.$Shape} C2S_CreateCharacter
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_CreateCharacter & jpt.base.C2S_CreateCharacter.$Shape;

            /**
             * Verifies a C2S_CreateCharacter message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_CreateCharacter message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_CreateCharacter
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_CreateCharacter;

            /**
             * Creates a plain object from a C2S_CreateCharacter message. Also converts values to other types if specified.
             * @param message C2S_CreateCharacter
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_CreateCharacter, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_CreateCharacter to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_CreateCharacter
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_CreateCharacter {

            /** Properties of a C2S_CreateCharacter. */
            interface $Properties {

                /** C2S_CreateCharacter name */
                name?: (string|null);

                /** C2S_CreateCharacter classId */
                classId?: (number|null);

                /** C2S_CreateCharacter head */
                head?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_CreateCharacter. */
            type $Shape = jpt.base.C2S_CreateCharacter.$Properties;
        }

        /**
         * Properties of a C2S_SelectCharacter.
         * @deprecated Use jpt.base.C2S_SelectCharacter.$Properties instead.
         */
        interface IC2S_SelectCharacter extends jpt.base.C2S_SelectCharacter.$Properties {
        }

        /** Represents a C2S_SelectCharacter. */
        class C2S_SelectCharacter {

            /**
             * Constructs a new C2S_SelectCharacter.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_SelectCharacter.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_SelectCharacter characterId. */
            characterId: (number|Long);

            /**
             * Creates a new C2S_SelectCharacter instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_SelectCharacter instance
             */
            static create(properties: jpt.base.C2S_SelectCharacter.$Shape): jpt.base.C2S_SelectCharacter & jpt.base.C2S_SelectCharacter.$Shape;
            static create(properties?: jpt.base.C2S_SelectCharacter.$Properties): jpt.base.C2S_SelectCharacter;

            /**
             * Encodes the specified C2S_SelectCharacter message. Does not implicitly {@link jpt.base.C2S_SelectCharacter.verify|verify} messages.
             * @param message C2S_SelectCharacter message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_SelectCharacter.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_SelectCharacter message, length delimited. Does not implicitly {@link jpt.base.C2S_SelectCharacter.verify|verify} messages.
             * @param message C2S_SelectCharacter message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_SelectCharacter.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_SelectCharacter message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_SelectCharacter & jpt.base.C2S_SelectCharacter.$Shape} C2S_SelectCharacter
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_SelectCharacter & jpt.base.C2S_SelectCharacter.$Shape;

            /**
             * Decodes a C2S_SelectCharacter message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_SelectCharacter & jpt.base.C2S_SelectCharacter.$Shape} C2S_SelectCharacter
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_SelectCharacter & jpt.base.C2S_SelectCharacter.$Shape;

            /**
             * Verifies a C2S_SelectCharacter message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_SelectCharacter message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_SelectCharacter
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_SelectCharacter;

            /**
             * Creates a plain object from a C2S_SelectCharacter message. Also converts values to other types if specified.
             * @param message C2S_SelectCharacter
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_SelectCharacter, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_SelectCharacter to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_SelectCharacter
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_SelectCharacter {

            /** Properties of a C2S_SelectCharacter. */
            interface $Properties {

                /** C2S_SelectCharacter characterId */
                characterId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_SelectCharacter. */
            type $Shape = jpt.base.C2S_SelectCharacter.$Properties;
        }

        /**
         * Properties of a C2S_Logout.
         * @deprecated Use jpt.base.C2S_Logout.$Properties instead.
         */
        interface IC2S_Logout extends jpt.base.C2S_Logout.$Properties {
        }

        /** Represents a C2S_Logout. */
        class C2S_Logout {

            /**
             * Constructs a new C2S_Logout.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_Logout.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /**
             * Creates a new C2S_Logout instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_Logout instance
             */
            static create(properties: jpt.base.C2S_Logout.$Shape): jpt.base.C2S_Logout & jpt.base.C2S_Logout.$Shape;
            static create(properties?: jpt.base.C2S_Logout.$Properties): jpt.base.C2S_Logout;

            /**
             * Encodes the specified C2S_Logout message. Does not implicitly {@link jpt.base.C2S_Logout.verify|verify} messages.
             * @param message C2S_Logout message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_Logout.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_Logout message, length delimited. Does not implicitly {@link jpt.base.C2S_Logout.verify|verify} messages.
             * @param message C2S_Logout message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_Logout.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_Logout message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_Logout & jpt.base.C2S_Logout.$Shape} C2S_Logout
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_Logout & jpt.base.C2S_Logout.$Shape;

            /**
             * Decodes a C2S_Logout message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_Logout & jpt.base.C2S_Logout.$Shape} C2S_Logout
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_Logout & jpt.base.C2S_Logout.$Shape;

            /**
             * Verifies a C2S_Logout message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_Logout message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_Logout
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_Logout;

            /**
             * Creates a plain object from a C2S_Logout message. Also converts values to other types if specified.
             * @param message C2S_Logout
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_Logout, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_Logout to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_Logout
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_Logout {

            /** Properties of a C2S_Logout. */
            interface $Properties {

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_Logout. */
            type $Shape = jpt.base.C2S_Logout.$Properties;
        }

        /**
         * Properties of a C2S_BackToCharacterSelect.
         * @deprecated Use jpt.base.C2S_BackToCharacterSelect.$Properties instead.
         */
        interface IC2S_BackToCharacterSelect extends jpt.base.C2S_BackToCharacterSelect.$Properties {
        }

        /** Represents a C2S_BackToCharacterSelect. */
        class C2S_BackToCharacterSelect {

            /**
             * Constructs a new C2S_BackToCharacterSelect.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_BackToCharacterSelect.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /**
             * Creates a new C2S_BackToCharacterSelect instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_BackToCharacterSelect instance
             */
            static create(properties: jpt.base.C2S_BackToCharacterSelect.$Shape): jpt.base.C2S_BackToCharacterSelect & jpt.base.C2S_BackToCharacterSelect.$Shape;
            static create(properties?: jpt.base.C2S_BackToCharacterSelect.$Properties): jpt.base.C2S_BackToCharacterSelect;

            /**
             * Encodes the specified C2S_BackToCharacterSelect message. Does not implicitly {@link jpt.base.C2S_BackToCharacterSelect.verify|verify} messages.
             * @param message C2S_BackToCharacterSelect message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_BackToCharacterSelect.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_BackToCharacterSelect message, length delimited. Does not implicitly {@link jpt.base.C2S_BackToCharacterSelect.verify|verify} messages.
             * @param message C2S_BackToCharacterSelect message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_BackToCharacterSelect.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_BackToCharacterSelect message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_BackToCharacterSelect & jpt.base.C2S_BackToCharacterSelect.$Shape} C2S_BackToCharacterSelect
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_BackToCharacterSelect & jpt.base.C2S_BackToCharacterSelect.$Shape;

            /**
             * Decodes a C2S_BackToCharacterSelect message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_BackToCharacterSelect & jpt.base.C2S_BackToCharacterSelect.$Shape} C2S_BackToCharacterSelect
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_BackToCharacterSelect & jpt.base.C2S_BackToCharacterSelect.$Shape;

            /**
             * Verifies a C2S_BackToCharacterSelect message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_BackToCharacterSelect message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_BackToCharacterSelect
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_BackToCharacterSelect;

            /**
             * Creates a plain object from a C2S_BackToCharacterSelect message. Also converts values to other types if specified.
             * @param message C2S_BackToCharacterSelect
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_BackToCharacterSelect, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_BackToCharacterSelect to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_BackToCharacterSelect
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_BackToCharacterSelect {

            /** Properties of a C2S_BackToCharacterSelect. */
            interface $Properties {

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_BackToCharacterSelect. */
            type $Shape = jpt.base.C2S_BackToCharacterSelect.$Properties;
        }

        /**
         * Properties of a S2C_LoginResponse.
         * @deprecated Use jpt.base.S2C_LoginResponse.$Properties instead.
         */
        interface IS2C_LoginResponse extends jpt.base.S2C_LoginResponse.$Properties {
        }

        /** Represents a S2C_LoginResponse. */
        class S2C_LoginResponse {

            /**
             * Constructs a new S2C_LoginResponse.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_LoginResponse.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_LoginResponse success. */
            success: boolean;

            /** S2C_LoginResponse accountId. */
            accountId: (number|Long);

            /** S2C_LoginResponse errorCode. */
            errorCode: jpt.base.ErrorCode;

            /** S2C_LoginResponse errorMessage. */
            errorMessage: string;

            /**
             * Creates a new S2C_LoginResponse instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_LoginResponse instance
             */
            static create(properties: jpt.base.S2C_LoginResponse.$Shape): jpt.base.S2C_LoginResponse & jpt.base.S2C_LoginResponse.$Shape;
            static create(properties?: jpt.base.S2C_LoginResponse.$Properties): jpt.base.S2C_LoginResponse;

            /**
             * Encodes the specified S2C_LoginResponse message. Does not implicitly {@link jpt.base.S2C_LoginResponse.verify|verify} messages.
             * @param message S2C_LoginResponse message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_LoginResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_LoginResponse message, length delimited. Does not implicitly {@link jpt.base.S2C_LoginResponse.verify|verify} messages.
             * @param message S2C_LoginResponse message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_LoginResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_LoginResponse message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_LoginResponse & jpt.base.S2C_LoginResponse.$Shape} S2C_LoginResponse
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_LoginResponse & jpt.base.S2C_LoginResponse.$Shape;

            /**
             * Decodes a S2C_LoginResponse message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_LoginResponse & jpt.base.S2C_LoginResponse.$Shape} S2C_LoginResponse
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_LoginResponse & jpt.base.S2C_LoginResponse.$Shape;

            /**
             * Verifies a S2C_LoginResponse message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_LoginResponse message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_LoginResponse
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_LoginResponse;

            /**
             * Creates a plain object from a S2C_LoginResponse message. Also converts values to other types if specified.
             * @param message S2C_LoginResponse
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_LoginResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_LoginResponse to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_LoginResponse
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_LoginResponse {

            /** Properties of a S2C_LoginResponse. */
            interface $Properties {

                /** S2C_LoginResponse success */
                success?: (boolean|null);

                /** S2C_LoginResponse accountId */
                accountId?: (number|Long|null);

                /** S2C_LoginResponse errorCode */
                errorCode?: (jpt.base.ErrorCode|null);

                /** S2C_LoginResponse errorMessage */
                errorMessage?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_LoginResponse. */
            type $Shape = jpt.base.S2C_LoginResponse.$Properties;
        }

        /**
         * Properties of a S2C_CharacterList.
         * @deprecated Use jpt.base.S2C_CharacterList.$Properties instead.
         */
        interface IS2C_CharacterList extends jpt.base.S2C_CharacterList.$Properties {
        }

        /** Represents a S2C_CharacterList. */
        class S2C_CharacterList {

            /**
             * Constructs a new S2C_CharacterList.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_CharacterList.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_CharacterList characters. */
            characters: jpt.base.CharacterInfo.$Properties[];

            /**
             * Creates a new S2C_CharacterList instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_CharacterList instance
             */
            static create(properties: jpt.base.S2C_CharacterList.$Shape): jpt.base.S2C_CharacterList & jpt.base.S2C_CharacterList.$Shape;
            static create(properties?: jpt.base.S2C_CharacterList.$Properties): jpt.base.S2C_CharacterList;

            /**
             * Encodes the specified S2C_CharacterList message. Does not implicitly {@link jpt.base.S2C_CharacterList.verify|verify} messages.
             * @param message S2C_CharacterList message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_CharacterList.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_CharacterList message, length delimited. Does not implicitly {@link jpt.base.S2C_CharacterList.verify|verify} messages.
             * @param message S2C_CharacterList message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_CharacterList.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_CharacterList message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_CharacterList & jpt.base.S2C_CharacterList.$Shape} S2C_CharacterList
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_CharacterList & jpt.base.S2C_CharacterList.$Shape;

            /**
             * Decodes a S2C_CharacterList message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_CharacterList & jpt.base.S2C_CharacterList.$Shape} S2C_CharacterList
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_CharacterList & jpt.base.S2C_CharacterList.$Shape;

            /**
             * Verifies a S2C_CharacterList message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_CharacterList message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_CharacterList
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_CharacterList;

            /**
             * Creates a plain object from a S2C_CharacterList message. Also converts values to other types if specified.
             * @param message S2C_CharacterList
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_CharacterList, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_CharacterList to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_CharacterList
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_CharacterList {

            /** Properties of a S2C_CharacterList. */
            interface $Properties {

                /** S2C_CharacterList characters */
                characters?: (jpt.base.CharacterInfo.$Properties[]|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_CharacterList. */
            type $Shape = jpt.base.S2C_CharacterList.$Properties;
        }

        /**
         * Properties of a CharacterInfo.
         * @deprecated Use jpt.base.CharacterInfo.$Properties instead.
         */
        interface ICharacterInfo extends jpt.base.CharacterInfo.$Properties {
        }

        /** Represents a CharacterInfo. */
        class CharacterInfo {

            /**
             * Constructs a new CharacterInfo.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.CharacterInfo.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** CharacterInfo characterId. */
            characterId: (number|Long);

            /** CharacterInfo name. */
            name: string;

            /** CharacterInfo classId. */
            classId: number;

            /** CharacterInfo level. */
            level: number;

            /** CharacterInfo position. */
            position?: (jpt.base.Position.$Properties|null);

            /** CharacterInfo mapId. */
            mapId: number;

            /** CharacterInfo appearance. */
            appearance?: (jpt.base.CharacterAppearance.$Properties|null);

            /**
             * Creates a new CharacterInfo instance using the specified properties.
             * @param [properties] Properties to set
             * @returns CharacterInfo instance
             */
            static create(properties: jpt.base.CharacterInfo.$Shape): jpt.base.CharacterInfo & jpt.base.CharacterInfo.$Shape;
            static create(properties?: jpt.base.CharacterInfo.$Properties): jpt.base.CharacterInfo;

            /**
             * Encodes the specified CharacterInfo message. Does not implicitly {@link jpt.base.CharacterInfo.verify|verify} messages.
             * @param message CharacterInfo message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.CharacterInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified CharacterInfo message, length delimited. Does not implicitly {@link jpt.base.CharacterInfo.verify|verify} messages.
             * @param message CharacterInfo message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.CharacterInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a CharacterInfo message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.CharacterInfo & jpt.base.CharacterInfo.$Shape} CharacterInfo
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.CharacterInfo & jpt.base.CharacterInfo.$Shape;

            /**
             * Decodes a CharacterInfo message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.CharacterInfo & jpt.base.CharacterInfo.$Shape} CharacterInfo
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.CharacterInfo & jpt.base.CharacterInfo.$Shape;

            /**
             * Verifies a CharacterInfo message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a CharacterInfo message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns CharacterInfo
             */
            static fromObject(object: { [k: string]: any }): jpt.base.CharacterInfo;

            /**
             * Creates a plain object from a CharacterInfo message. Also converts values to other types if specified.
             * @param message CharacterInfo
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.CharacterInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this CharacterInfo to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for CharacterInfo
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace CharacterInfo {

            /** Properties of a CharacterInfo. */
            interface $Properties {

                /** CharacterInfo characterId */
                characterId?: (number|Long|null);

                /** CharacterInfo name */
                name?: (string|null);

                /** CharacterInfo classId */
                classId?: (number|null);

                /** CharacterInfo level */
                level?: (number|null);

                /** CharacterInfo position */
                position?: (jpt.base.Position.$Properties|null);

                /** CharacterInfo mapId */
                mapId?: (number|null);

                /** CharacterInfo appearance */
                appearance?: (jpt.base.CharacterAppearance.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a CharacterInfo. */
            type $Shape = jpt.base.CharacterInfo.$Properties;
        }

        /**
         * Properties of a S2C_CreateCharacterResult.
         * @deprecated Use jpt.base.S2C_CreateCharacterResult.$Properties instead.
         */
        interface IS2C_CreateCharacterResult extends jpt.base.S2C_CreateCharacterResult.$Properties {
        }

        /** Represents a S2C_CreateCharacterResult. */
        class S2C_CreateCharacterResult {

            /**
             * Constructs a new S2C_CreateCharacterResult.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_CreateCharacterResult.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_CreateCharacterResult success. */
            success: boolean;

            /** S2C_CreateCharacterResult characterId. */
            characterId: (number|Long);

            /** S2C_CreateCharacterResult errorCode. */
            errorCode: jpt.base.ErrorCode;

            /**
             * Creates a new S2C_CreateCharacterResult instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_CreateCharacterResult instance
             */
            static create(properties: jpt.base.S2C_CreateCharacterResult.$Shape): jpt.base.S2C_CreateCharacterResult & jpt.base.S2C_CreateCharacterResult.$Shape;
            static create(properties?: jpt.base.S2C_CreateCharacterResult.$Properties): jpt.base.S2C_CreateCharacterResult;

            /**
             * Encodes the specified S2C_CreateCharacterResult message. Does not implicitly {@link jpt.base.S2C_CreateCharacterResult.verify|verify} messages.
             * @param message S2C_CreateCharacterResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_CreateCharacterResult.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_CreateCharacterResult message, length delimited. Does not implicitly {@link jpt.base.S2C_CreateCharacterResult.verify|verify} messages.
             * @param message S2C_CreateCharacterResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_CreateCharacterResult.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_CreateCharacterResult message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_CreateCharacterResult & jpt.base.S2C_CreateCharacterResult.$Shape} S2C_CreateCharacterResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_CreateCharacterResult & jpt.base.S2C_CreateCharacterResult.$Shape;

            /**
             * Decodes a S2C_CreateCharacterResult message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_CreateCharacterResult & jpt.base.S2C_CreateCharacterResult.$Shape} S2C_CreateCharacterResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_CreateCharacterResult & jpt.base.S2C_CreateCharacterResult.$Shape;

            /**
             * Verifies a S2C_CreateCharacterResult message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_CreateCharacterResult message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_CreateCharacterResult
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_CreateCharacterResult;

            /**
             * Creates a plain object from a S2C_CreateCharacterResult message. Also converts values to other types if specified.
             * @param message S2C_CreateCharacterResult
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_CreateCharacterResult, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_CreateCharacterResult to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_CreateCharacterResult
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_CreateCharacterResult {

            /** Properties of a S2C_CreateCharacterResult. */
            interface $Properties {

                /** S2C_CreateCharacterResult success */
                success?: (boolean|null);

                /** S2C_CreateCharacterResult characterId */
                characterId?: (number|Long|null);

                /** S2C_CreateCharacterResult errorCode */
                errorCode?: (jpt.base.ErrorCode|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_CreateCharacterResult. */
            type $Shape = jpt.base.S2C_CreateCharacterResult.$Properties;
        }

        /**
         * Properties of a C2S_PlayerMove.
         * @deprecated Use jpt.base.C2S_PlayerMove.$Properties instead.
         */
        interface IC2S_PlayerMove extends jpt.base.C2S_PlayerMove.$Properties {
        }

        /** Represents a C2S_PlayerMove. */
        class C2S_PlayerMove {

            /**
             * Constructs a new C2S_PlayerMove.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PlayerMove.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_PlayerMove newPosition. */
            newPosition?: (jpt.base.Position.$Properties|null);

            /** C2S_PlayerMove timestamp. */
            timestamp: (number|Long);

            /** C2S_PlayerMove speed. */
            speed: number;

            /**
             * Creates a new C2S_PlayerMove instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PlayerMove instance
             */
            static create(properties: jpt.base.C2S_PlayerMove.$Shape): jpt.base.C2S_PlayerMove & jpt.base.C2S_PlayerMove.$Shape;
            static create(properties?: jpt.base.C2S_PlayerMove.$Properties): jpt.base.C2S_PlayerMove;

            /**
             * Encodes the specified C2S_PlayerMove message. Does not implicitly {@link jpt.base.C2S_PlayerMove.verify|verify} messages.
             * @param message C2S_PlayerMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PlayerMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PlayerMove message, length delimited. Does not implicitly {@link jpt.base.C2S_PlayerMove.verify|verify} messages.
             * @param message C2S_PlayerMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PlayerMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PlayerMove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PlayerMove & jpt.base.C2S_PlayerMove.$Shape} C2S_PlayerMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PlayerMove & jpt.base.C2S_PlayerMove.$Shape;

            /**
             * Decodes a C2S_PlayerMove message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PlayerMove & jpt.base.C2S_PlayerMove.$Shape} C2S_PlayerMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PlayerMove & jpt.base.C2S_PlayerMove.$Shape;

            /**
             * Verifies a C2S_PlayerMove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PlayerMove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PlayerMove
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PlayerMove;

            /**
             * Creates a plain object from a C2S_PlayerMove message. Also converts values to other types if specified.
             * @param message C2S_PlayerMove
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PlayerMove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PlayerMove to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PlayerMove
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PlayerMove {

            /** Properties of a C2S_PlayerMove. */
            interface $Properties {

                /** C2S_PlayerMove newPosition */
                newPosition?: (jpt.base.Position.$Properties|null);

                /** C2S_PlayerMove timestamp */
                timestamp?: (number|Long|null);

                /** C2S_PlayerMove speed */
                speed?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PlayerMove. */
            type $Shape = jpt.base.C2S_PlayerMove.$Properties;
        }

        /**
         * Properties of a C2S_PlayerAction.
         * @deprecated Use jpt.base.C2S_PlayerAction.$Properties instead.
         */
        interface IC2S_PlayerAction extends jpt.base.C2S_PlayerAction.$Properties {
        }

        /** Represents a C2S_PlayerAction. */
        class C2S_PlayerAction {

            /**
             * Constructs a new C2S_PlayerAction.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PlayerAction.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_PlayerAction actionType. */
            actionType: number;

            /** C2S_PlayerAction targetId. */
            targetId: (number|Long);

            /**
             * Creates a new C2S_PlayerAction instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PlayerAction instance
             */
            static create(properties: jpt.base.C2S_PlayerAction.$Shape): jpt.base.C2S_PlayerAction & jpt.base.C2S_PlayerAction.$Shape;
            static create(properties?: jpt.base.C2S_PlayerAction.$Properties): jpt.base.C2S_PlayerAction;

            /**
             * Encodes the specified C2S_PlayerAction message. Does not implicitly {@link jpt.base.C2S_PlayerAction.verify|verify} messages.
             * @param message C2S_PlayerAction message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PlayerAction.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PlayerAction message, length delimited. Does not implicitly {@link jpt.base.C2S_PlayerAction.verify|verify} messages.
             * @param message C2S_PlayerAction message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PlayerAction.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PlayerAction message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PlayerAction & jpt.base.C2S_PlayerAction.$Shape} C2S_PlayerAction
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PlayerAction & jpt.base.C2S_PlayerAction.$Shape;

            /**
             * Decodes a C2S_PlayerAction message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PlayerAction & jpt.base.C2S_PlayerAction.$Shape} C2S_PlayerAction
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PlayerAction & jpt.base.C2S_PlayerAction.$Shape;

            /**
             * Verifies a C2S_PlayerAction message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PlayerAction message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PlayerAction
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PlayerAction;

            /**
             * Creates a plain object from a C2S_PlayerAction message. Also converts values to other types if specified.
             * @param message C2S_PlayerAction
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PlayerAction, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PlayerAction to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PlayerAction
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PlayerAction {

            /** Properties of a C2S_PlayerAction. */
            interface $Properties {

                /** C2S_PlayerAction actionType */
                actionType?: (number|null);

                /** C2S_PlayerAction targetId */
                targetId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PlayerAction. */
            type $Shape = jpt.base.C2S_PlayerAction.$Properties;
        }

        /**
         * Properties of a C2S_UseItem.
         * @deprecated Use jpt.base.C2S_UseItem.$Properties instead.
         */
        interface IC2S_UseItem extends jpt.base.C2S_UseItem.$Properties {
        }

        /** Represents a C2S_UseItem. */
        class C2S_UseItem {

            /**
             * Constructs a new C2S_UseItem.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_UseItem.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_UseItem itemId. */
            itemId: number;

            /** C2S_UseItem quantity. */
            quantity: number;

            /**
             * Creates a new C2S_UseItem instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_UseItem instance
             */
            static create(properties: jpt.base.C2S_UseItem.$Shape): jpt.base.C2S_UseItem & jpt.base.C2S_UseItem.$Shape;
            static create(properties?: jpt.base.C2S_UseItem.$Properties): jpt.base.C2S_UseItem;

            /**
             * Encodes the specified C2S_UseItem message. Does not implicitly {@link jpt.base.C2S_UseItem.verify|verify} messages.
             * @param message C2S_UseItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_UseItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_UseItem message, length delimited. Does not implicitly {@link jpt.base.C2S_UseItem.verify|verify} messages.
             * @param message C2S_UseItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_UseItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_UseItem message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_UseItem & jpt.base.C2S_UseItem.$Shape} C2S_UseItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_UseItem & jpt.base.C2S_UseItem.$Shape;

            /**
             * Decodes a C2S_UseItem message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_UseItem & jpt.base.C2S_UseItem.$Shape} C2S_UseItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_UseItem & jpt.base.C2S_UseItem.$Shape;

            /**
             * Verifies a C2S_UseItem message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_UseItem message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_UseItem
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_UseItem;

            /**
             * Creates a plain object from a C2S_UseItem message. Also converts values to other types if specified.
             * @param message C2S_UseItem
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_UseItem, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_UseItem to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_UseItem
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_UseItem {

            /** Properties of a C2S_UseItem. */
            interface $Properties {

                /** C2S_UseItem itemId */
                itemId?: (number|null);

                /** C2S_UseItem quantity */
                quantity?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_UseItem. */
            type $Shape = jpt.base.C2S_UseItem.$Properties;
        }

        /**
         * Properties of a C2S_PickupItem.
         * @deprecated Use jpt.base.C2S_PickupItem.$Properties instead.
         */
        interface IC2S_PickupItem extends jpt.base.C2S_PickupItem.$Properties {
        }

        /** Represents a C2S_PickupItem. */
        class C2S_PickupItem {

            /**
             * Constructs a new C2S_PickupItem.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PickupItem.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_PickupItem groundItemId. */
            groundItemId: (number|Long);

            /**
             * Creates a new C2S_PickupItem instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PickupItem instance
             */
            static create(properties: jpt.base.C2S_PickupItem.$Shape): jpt.base.C2S_PickupItem & jpt.base.C2S_PickupItem.$Shape;
            static create(properties?: jpt.base.C2S_PickupItem.$Properties): jpt.base.C2S_PickupItem;

            /**
             * Encodes the specified C2S_PickupItem message. Does not implicitly {@link jpt.base.C2S_PickupItem.verify|verify} messages.
             * @param message C2S_PickupItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PickupItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PickupItem message, length delimited. Does not implicitly {@link jpt.base.C2S_PickupItem.verify|verify} messages.
             * @param message C2S_PickupItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PickupItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PickupItem message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PickupItem & jpt.base.C2S_PickupItem.$Shape} C2S_PickupItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PickupItem & jpt.base.C2S_PickupItem.$Shape;

            /**
             * Decodes a C2S_PickupItem message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PickupItem & jpt.base.C2S_PickupItem.$Shape} C2S_PickupItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PickupItem & jpt.base.C2S_PickupItem.$Shape;

            /**
             * Verifies a C2S_PickupItem message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PickupItem message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PickupItem
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PickupItem;

            /**
             * Creates a plain object from a C2S_PickupItem message. Also converts values to other types if specified.
             * @param message C2S_PickupItem
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PickupItem, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PickupItem to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PickupItem
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PickupItem {

            /** Properties of a C2S_PickupItem. */
            interface $Properties {

                /** C2S_PickupItem groundItemId */
                groundItemId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PickupItem. */
            type $Shape = jpt.base.C2S_PickupItem.$Properties;
        }

        /**
         * Properties of a C2S_DropItem.
         * @deprecated Use jpt.base.C2S_DropItem.$Properties instead.
         */
        interface IC2S_DropItem extends jpt.base.C2S_DropItem.$Properties {
        }

        /** Represents a C2S_DropItem. */
        class C2S_DropItem {

            /**
             * Constructs a new C2S_DropItem.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_DropItem.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_DropItem itemId. */
            itemId: number;

            /** C2S_DropItem quantity. */
            quantity: number;

            /**
             * Creates a new C2S_DropItem instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_DropItem instance
             */
            static create(properties: jpt.base.C2S_DropItem.$Shape): jpt.base.C2S_DropItem & jpt.base.C2S_DropItem.$Shape;
            static create(properties?: jpt.base.C2S_DropItem.$Properties): jpt.base.C2S_DropItem;

            /**
             * Encodes the specified C2S_DropItem message. Does not implicitly {@link jpt.base.C2S_DropItem.verify|verify} messages.
             * @param message C2S_DropItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_DropItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_DropItem message, length delimited. Does not implicitly {@link jpt.base.C2S_DropItem.verify|verify} messages.
             * @param message C2S_DropItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_DropItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_DropItem message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_DropItem & jpt.base.C2S_DropItem.$Shape} C2S_DropItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_DropItem & jpt.base.C2S_DropItem.$Shape;

            /**
             * Decodes a C2S_DropItem message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_DropItem & jpt.base.C2S_DropItem.$Shape} C2S_DropItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_DropItem & jpt.base.C2S_DropItem.$Shape;

            /**
             * Verifies a C2S_DropItem message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_DropItem message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_DropItem
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_DropItem;

            /**
             * Creates a plain object from a C2S_DropItem message. Also converts values to other types if specified.
             * @param message C2S_DropItem
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_DropItem, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_DropItem to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_DropItem
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_DropItem {

            /** Properties of a C2S_DropItem. */
            interface $Properties {

                /** C2S_DropItem itemId */
                itemId?: (number|null);

                /** C2S_DropItem quantity */
                quantity?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_DropItem. */
            type $Shape = jpt.base.C2S_DropItem.$Properties;
        }

        /**
         * Properties of a S2C_PlayerAppear.
         * @deprecated Use jpt.base.S2C_PlayerAppear.$Properties instead.
         */
        interface IS2C_PlayerAppear extends jpt.base.S2C_PlayerAppear.$Properties {
        }

        /** Represents a S2C_PlayerAppear. */
        class S2C_PlayerAppear {

            /**
             * Constructs a new S2C_PlayerAppear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerAppear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerAppear playerId. */
            playerId: (number|Long);

            /** S2C_PlayerAppear name. */
            name: string;

            /** S2C_PlayerAppear classId. */
            classId: number;

            /** S2C_PlayerAppear level. */
            level: number;

            /** S2C_PlayerAppear position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_PlayerAppear hp. */
            hp: number;

            /** S2C_PlayerAppear maxHp. */
            maxHp: number;

            /**
             * Creates a new S2C_PlayerAppear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerAppear instance
             */
            static create(properties: jpt.base.S2C_PlayerAppear.$Shape): jpt.base.S2C_PlayerAppear & jpt.base.S2C_PlayerAppear.$Shape;
            static create(properties?: jpt.base.S2C_PlayerAppear.$Properties): jpt.base.S2C_PlayerAppear;

            /**
             * Encodes the specified S2C_PlayerAppear message. Does not implicitly {@link jpt.base.S2C_PlayerAppear.verify|verify} messages.
             * @param message S2C_PlayerAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerAppear message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerAppear.verify|verify} messages.
             * @param message S2C_PlayerAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerAppear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerAppear & jpt.base.S2C_PlayerAppear.$Shape} S2C_PlayerAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerAppear & jpt.base.S2C_PlayerAppear.$Shape;

            /**
             * Decodes a S2C_PlayerAppear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerAppear & jpt.base.S2C_PlayerAppear.$Shape} S2C_PlayerAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerAppear & jpt.base.S2C_PlayerAppear.$Shape;

            /**
             * Verifies a S2C_PlayerAppear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerAppear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerAppear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerAppear;

            /**
             * Creates a plain object from a S2C_PlayerAppear message. Also converts values to other types if specified.
             * @param message S2C_PlayerAppear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerAppear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerAppear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerAppear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerAppear {

            /** Properties of a S2C_PlayerAppear. */
            interface $Properties {

                /** S2C_PlayerAppear playerId */
                playerId?: (number|Long|null);

                /** S2C_PlayerAppear name */
                name?: (string|null);

                /** S2C_PlayerAppear classId */
                classId?: (number|null);

                /** S2C_PlayerAppear level */
                level?: (number|null);

                /** S2C_PlayerAppear position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_PlayerAppear hp */
                hp?: (number|null);

                /** S2C_PlayerAppear maxHp */
                maxHp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerAppear. */
            type $Shape = jpt.base.S2C_PlayerAppear.$Properties;
        }

        /**
         * Properties of a S2C_PlayerDisappear.
         * @deprecated Use jpt.base.S2C_PlayerDisappear.$Properties instead.
         */
        interface IS2C_PlayerDisappear extends jpt.base.S2C_PlayerDisappear.$Properties {
        }

        /** Represents a S2C_PlayerDisappear. */
        class S2C_PlayerDisappear {

            /**
             * Constructs a new S2C_PlayerDisappear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerDisappear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerDisappear playerId. */
            playerId: (number|Long);

            /**
             * Creates a new S2C_PlayerDisappear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerDisappear instance
             */
            static create(properties: jpt.base.S2C_PlayerDisappear.$Shape): jpt.base.S2C_PlayerDisappear & jpt.base.S2C_PlayerDisappear.$Shape;
            static create(properties?: jpt.base.S2C_PlayerDisappear.$Properties): jpt.base.S2C_PlayerDisappear;

            /**
             * Encodes the specified S2C_PlayerDisappear message. Does not implicitly {@link jpt.base.S2C_PlayerDisappear.verify|verify} messages.
             * @param message S2C_PlayerDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerDisappear message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerDisappear.verify|verify} messages.
             * @param message S2C_PlayerDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerDisappear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerDisappear & jpt.base.S2C_PlayerDisappear.$Shape} S2C_PlayerDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerDisappear & jpt.base.S2C_PlayerDisappear.$Shape;

            /**
             * Decodes a S2C_PlayerDisappear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerDisappear & jpt.base.S2C_PlayerDisappear.$Shape} S2C_PlayerDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerDisappear & jpt.base.S2C_PlayerDisappear.$Shape;

            /**
             * Verifies a S2C_PlayerDisappear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerDisappear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerDisappear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerDisappear;

            /**
             * Creates a plain object from a S2C_PlayerDisappear message. Also converts values to other types if specified.
             * @param message S2C_PlayerDisappear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerDisappear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerDisappear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerDisappear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerDisappear {

            /** Properties of a S2C_PlayerDisappear. */
            interface $Properties {

                /** S2C_PlayerDisappear playerId */
                playerId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerDisappear. */
            type $Shape = jpt.base.S2C_PlayerDisappear.$Properties;
        }

        /**
         * Properties of a S2C_PlayerMove.
         * @deprecated Use jpt.base.S2C_PlayerMove.$Properties instead.
         */
        interface IS2C_PlayerMove extends jpt.base.S2C_PlayerMove.$Properties {
        }

        /** Represents a S2C_PlayerMove. */
        class S2C_PlayerMove {

            /**
             * Constructs a new S2C_PlayerMove.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerMove.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerMove playerId. */
            playerId: (number|Long);

            /** S2C_PlayerMove position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_PlayerMove timestamp. */
            timestamp: (number|Long);

            /**
             * Creates a new S2C_PlayerMove instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerMove instance
             */
            static create(properties: jpt.base.S2C_PlayerMove.$Shape): jpt.base.S2C_PlayerMove & jpt.base.S2C_PlayerMove.$Shape;
            static create(properties?: jpt.base.S2C_PlayerMove.$Properties): jpt.base.S2C_PlayerMove;

            /**
             * Encodes the specified S2C_PlayerMove message. Does not implicitly {@link jpt.base.S2C_PlayerMove.verify|verify} messages.
             * @param message S2C_PlayerMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerMove message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerMove.verify|verify} messages.
             * @param message S2C_PlayerMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerMove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerMove & jpt.base.S2C_PlayerMove.$Shape} S2C_PlayerMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerMove & jpt.base.S2C_PlayerMove.$Shape;

            /**
             * Decodes a S2C_PlayerMove message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerMove & jpt.base.S2C_PlayerMove.$Shape} S2C_PlayerMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerMove & jpt.base.S2C_PlayerMove.$Shape;

            /**
             * Verifies a S2C_PlayerMove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerMove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerMove
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerMove;

            /**
             * Creates a plain object from a S2C_PlayerMove message. Also converts values to other types if specified.
             * @param message S2C_PlayerMove
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerMove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerMove to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerMove
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerMove {

            /** Properties of a S2C_PlayerMove. */
            interface $Properties {

                /** S2C_PlayerMove playerId */
                playerId?: (number|Long|null);

                /** S2C_PlayerMove position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_PlayerMove timestamp */
                timestamp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerMove. */
            type $Shape = jpt.base.S2C_PlayerMove.$Properties;
        }

        /**
         * Properties of a S2C_PlayerState.
         * @deprecated Use jpt.base.S2C_PlayerState.$Properties instead.
         */
        interface IS2C_PlayerState extends jpt.base.S2C_PlayerState.$Properties {
        }

        /** Represents a S2C_PlayerState. */
        class S2C_PlayerState {

            /**
             * Constructs a new S2C_PlayerState.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerState.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerState playerId. */
            playerId: (number|Long);

            /** S2C_PlayerState position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_PlayerState mapId. */
            mapId: number;

            /** S2C_PlayerState hp. */
            hp: number;

            /** S2C_PlayerState mp. */
            mp: number;

            /** S2C_PlayerState maxHp. */
            maxHp: number;

            /** S2C_PlayerState maxMp. */
            maxMp: number;

            /** S2C_PlayerState level. */
            level: number;

            /** S2C_PlayerState gold. */
            gold: (number|Long);

            /** S2C_PlayerState exp. */
            exp: (number|Long);

            /**
             * Creates a new S2C_PlayerState instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerState instance
             */
            static create(properties: jpt.base.S2C_PlayerState.$Shape): jpt.base.S2C_PlayerState & jpt.base.S2C_PlayerState.$Shape;
            static create(properties?: jpt.base.S2C_PlayerState.$Properties): jpt.base.S2C_PlayerState;

            /**
             * Encodes the specified S2C_PlayerState message. Does not implicitly {@link jpt.base.S2C_PlayerState.verify|verify} messages.
             * @param message S2C_PlayerState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerState.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerState message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerState.verify|verify} messages.
             * @param message S2C_PlayerState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerState.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerState & jpt.base.S2C_PlayerState.$Shape} S2C_PlayerState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerState & jpt.base.S2C_PlayerState.$Shape;

            /**
             * Decodes a S2C_PlayerState message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerState & jpt.base.S2C_PlayerState.$Shape} S2C_PlayerState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerState & jpt.base.S2C_PlayerState.$Shape;

            /**
             * Verifies a S2C_PlayerState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerState
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerState;

            /**
             * Creates a plain object from a S2C_PlayerState message. Also converts values to other types if specified.
             * @param message S2C_PlayerState
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerState to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerState
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerState {

            /** Properties of a S2C_PlayerState. */
            interface $Properties {

                /** S2C_PlayerState playerId */
                playerId?: (number|Long|null);

                /** S2C_PlayerState position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_PlayerState mapId */
                mapId?: (number|null);

                /** S2C_PlayerState hp */
                hp?: (number|null);

                /** S2C_PlayerState mp */
                mp?: (number|null);

                /** S2C_PlayerState maxHp */
                maxHp?: (number|null);

                /** S2C_PlayerState maxMp */
                maxMp?: (number|null);

                /** S2C_PlayerState level */
                level?: (number|null);

                /** S2C_PlayerState gold */
                gold?: (number|Long|null);

                /** S2C_PlayerState exp */
                exp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerState. */
            type $Shape = jpt.base.S2C_PlayerState.$Properties;
        }

        /**
         * Properties of a S2C_PlayerDeath.
         * @deprecated Use jpt.base.S2C_PlayerDeath.$Properties instead.
         */
        interface IS2C_PlayerDeath extends jpt.base.S2C_PlayerDeath.$Properties {
        }

        /** Represents a S2C_PlayerDeath. */
        class S2C_PlayerDeath {

            /**
             * Constructs a new S2C_PlayerDeath.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerDeath.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerDeath playerId. */
            playerId: (number|Long);

            /** S2C_PlayerDeath expLoss. */
            expLoss: (number|Long);

            /**
             * Creates a new S2C_PlayerDeath instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerDeath instance
             */
            static create(properties: jpt.base.S2C_PlayerDeath.$Shape): jpt.base.S2C_PlayerDeath & jpt.base.S2C_PlayerDeath.$Shape;
            static create(properties?: jpt.base.S2C_PlayerDeath.$Properties): jpt.base.S2C_PlayerDeath;

            /**
             * Encodes the specified S2C_PlayerDeath message. Does not implicitly {@link jpt.base.S2C_PlayerDeath.verify|verify} messages.
             * @param message S2C_PlayerDeath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerDeath.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerDeath message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerDeath.verify|verify} messages.
             * @param message S2C_PlayerDeath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerDeath.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerDeath message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerDeath & jpt.base.S2C_PlayerDeath.$Shape} S2C_PlayerDeath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerDeath & jpt.base.S2C_PlayerDeath.$Shape;

            /**
             * Decodes a S2C_PlayerDeath message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerDeath & jpt.base.S2C_PlayerDeath.$Shape} S2C_PlayerDeath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerDeath & jpt.base.S2C_PlayerDeath.$Shape;

            /**
             * Verifies a S2C_PlayerDeath message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerDeath message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerDeath
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerDeath;

            /**
             * Creates a plain object from a S2C_PlayerDeath message. Also converts values to other types if specified.
             * @param message S2C_PlayerDeath
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerDeath, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerDeath to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerDeath
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerDeath {

            /** Properties of a S2C_PlayerDeath. */
            interface $Properties {

                /** S2C_PlayerDeath playerId */
                playerId?: (number|Long|null);

                /** S2C_PlayerDeath expLoss */
                expLoss?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerDeath. */
            type $Shape = jpt.base.S2C_PlayerDeath.$Properties;
        }

        /**
         * Properties of a S2C_PlayerRespawn.
         * @deprecated Use jpt.base.S2C_PlayerRespawn.$Properties instead.
         */
        interface IS2C_PlayerRespawn extends jpt.base.S2C_PlayerRespawn.$Properties {
        }

        /** Represents a S2C_PlayerRespawn. */
        class S2C_PlayerRespawn {

            /**
             * Constructs a new S2C_PlayerRespawn.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PlayerRespawn.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PlayerRespawn playerId. */
            playerId: (number|Long);

            /** S2C_PlayerRespawn position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_PlayerRespawn hp. */
            hp: number;

            /** S2C_PlayerRespawn mp. */
            mp: number;

            /**
             * Creates a new S2C_PlayerRespawn instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PlayerRespawn instance
             */
            static create(properties: jpt.base.S2C_PlayerRespawn.$Shape): jpt.base.S2C_PlayerRespawn & jpt.base.S2C_PlayerRespawn.$Shape;
            static create(properties?: jpt.base.S2C_PlayerRespawn.$Properties): jpt.base.S2C_PlayerRespawn;

            /**
             * Encodes the specified S2C_PlayerRespawn message. Does not implicitly {@link jpt.base.S2C_PlayerRespawn.verify|verify} messages.
             * @param message S2C_PlayerRespawn message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PlayerRespawn.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PlayerRespawn message, length delimited. Does not implicitly {@link jpt.base.S2C_PlayerRespawn.verify|verify} messages.
             * @param message S2C_PlayerRespawn message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PlayerRespawn.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PlayerRespawn message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PlayerRespawn & jpt.base.S2C_PlayerRespawn.$Shape} S2C_PlayerRespawn
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PlayerRespawn & jpt.base.S2C_PlayerRespawn.$Shape;

            /**
             * Decodes a S2C_PlayerRespawn message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PlayerRespawn & jpt.base.S2C_PlayerRespawn.$Shape} S2C_PlayerRespawn
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PlayerRespawn & jpt.base.S2C_PlayerRespawn.$Shape;

            /**
             * Verifies a S2C_PlayerRespawn message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PlayerRespawn message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PlayerRespawn
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PlayerRespawn;

            /**
             * Creates a plain object from a S2C_PlayerRespawn message. Also converts values to other types if specified.
             * @param message S2C_PlayerRespawn
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PlayerRespawn, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PlayerRespawn to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PlayerRespawn
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PlayerRespawn {

            /** Properties of a S2C_PlayerRespawn. */
            interface $Properties {

                /** S2C_PlayerRespawn playerId */
                playerId?: (number|Long|null);

                /** S2C_PlayerRespawn position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_PlayerRespawn hp */
                hp?: (number|null);

                /** S2C_PlayerRespawn mp */
                mp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PlayerRespawn. */
            type $Shape = jpt.base.S2C_PlayerRespawn.$Properties;
        }

        /**
         * Properties of a S2C_MonsterAppear.
         * @deprecated Use jpt.base.S2C_MonsterAppear.$Properties instead.
         */
        interface IS2C_MonsterAppear extends jpt.base.S2C_MonsterAppear.$Properties {
        }

        /** Represents a S2C_MonsterAppear. */
        class S2C_MonsterAppear {

            /**
             * Constructs a new S2C_MonsterAppear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_MonsterAppear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_MonsterAppear monsterId. */
            monsterId: (number|Long);

            /** S2C_MonsterAppear templateId. */
            templateId: number;

            /** S2C_MonsterAppear name. */
            name: string;

            /** S2C_MonsterAppear level. */
            level: number;

            /** S2C_MonsterAppear position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_MonsterAppear hp. */
            hp: number;

            /** S2C_MonsterAppear maxHp. */
            maxHp: number;

            /**
             * Creates a new S2C_MonsterAppear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_MonsterAppear instance
             */
            static create(properties: jpt.base.S2C_MonsterAppear.$Shape): jpt.base.S2C_MonsterAppear & jpt.base.S2C_MonsterAppear.$Shape;
            static create(properties?: jpt.base.S2C_MonsterAppear.$Properties): jpt.base.S2C_MonsterAppear;

            /**
             * Encodes the specified S2C_MonsterAppear message. Does not implicitly {@link jpt.base.S2C_MonsterAppear.verify|verify} messages.
             * @param message S2C_MonsterAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_MonsterAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_MonsterAppear message, length delimited. Does not implicitly {@link jpt.base.S2C_MonsterAppear.verify|verify} messages.
             * @param message S2C_MonsterAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_MonsterAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_MonsterAppear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_MonsterAppear & jpt.base.S2C_MonsterAppear.$Shape} S2C_MonsterAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_MonsterAppear & jpt.base.S2C_MonsterAppear.$Shape;

            /**
             * Decodes a S2C_MonsterAppear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_MonsterAppear & jpt.base.S2C_MonsterAppear.$Shape} S2C_MonsterAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_MonsterAppear & jpt.base.S2C_MonsterAppear.$Shape;

            /**
             * Verifies a S2C_MonsterAppear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_MonsterAppear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_MonsterAppear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_MonsterAppear;

            /**
             * Creates a plain object from a S2C_MonsterAppear message. Also converts values to other types if specified.
             * @param message S2C_MonsterAppear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_MonsterAppear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_MonsterAppear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_MonsterAppear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_MonsterAppear {

            /** Properties of a S2C_MonsterAppear. */
            interface $Properties {

                /** S2C_MonsterAppear monsterId */
                monsterId?: (number|Long|null);

                /** S2C_MonsterAppear templateId */
                templateId?: (number|null);

                /** S2C_MonsterAppear name */
                name?: (string|null);

                /** S2C_MonsterAppear level */
                level?: (number|null);

                /** S2C_MonsterAppear position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_MonsterAppear hp */
                hp?: (number|null);

                /** S2C_MonsterAppear maxHp */
                maxHp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_MonsterAppear. */
            type $Shape = jpt.base.S2C_MonsterAppear.$Properties;
        }

        /**
         * Properties of a S2C_MonsterDisappear.
         * @deprecated Use jpt.base.S2C_MonsterDisappear.$Properties instead.
         */
        interface IS2C_MonsterDisappear extends jpt.base.S2C_MonsterDisappear.$Properties {
        }

        /** Represents a S2C_MonsterDisappear. */
        class S2C_MonsterDisappear {

            /**
             * Constructs a new S2C_MonsterDisappear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_MonsterDisappear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_MonsterDisappear monsterId. */
            monsterId: (number|Long);

            /**
             * Creates a new S2C_MonsterDisappear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_MonsterDisappear instance
             */
            static create(properties: jpt.base.S2C_MonsterDisappear.$Shape): jpt.base.S2C_MonsterDisappear & jpt.base.S2C_MonsterDisappear.$Shape;
            static create(properties?: jpt.base.S2C_MonsterDisappear.$Properties): jpt.base.S2C_MonsterDisappear;

            /**
             * Encodes the specified S2C_MonsterDisappear message. Does not implicitly {@link jpt.base.S2C_MonsterDisappear.verify|verify} messages.
             * @param message S2C_MonsterDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_MonsterDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_MonsterDisappear message, length delimited. Does not implicitly {@link jpt.base.S2C_MonsterDisappear.verify|verify} messages.
             * @param message S2C_MonsterDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_MonsterDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_MonsterDisappear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_MonsterDisappear & jpt.base.S2C_MonsterDisappear.$Shape} S2C_MonsterDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_MonsterDisappear & jpt.base.S2C_MonsterDisappear.$Shape;

            /**
             * Decodes a S2C_MonsterDisappear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_MonsterDisappear & jpt.base.S2C_MonsterDisappear.$Shape} S2C_MonsterDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_MonsterDisappear & jpt.base.S2C_MonsterDisappear.$Shape;

            /**
             * Verifies a S2C_MonsterDisappear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_MonsterDisappear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_MonsterDisappear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_MonsterDisappear;

            /**
             * Creates a plain object from a S2C_MonsterDisappear message. Also converts values to other types if specified.
             * @param message S2C_MonsterDisappear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_MonsterDisappear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_MonsterDisappear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_MonsterDisappear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_MonsterDisappear {

            /** Properties of a S2C_MonsterDisappear. */
            interface $Properties {

                /** S2C_MonsterDisappear monsterId */
                monsterId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_MonsterDisappear. */
            type $Shape = jpt.base.S2C_MonsterDisappear.$Properties;
        }

        /**
         * Properties of a S2C_MonsterMove.
         * @deprecated Use jpt.base.S2C_MonsterMove.$Properties instead.
         */
        interface IS2C_MonsterMove extends jpt.base.S2C_MonsterMove.$Properties {
        }

        /** Represents a S2C_MonsterMove. */
        class S2C_MonsterMove {

            /**
             * Constructs a new S2C_MonsterMove.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_MonsterMove.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_MonsterMove monsterId. */
            monsterId: (number|Long);

            /** S2C_MonsterMove position. */
            position?: (jpt.base.Position.$Properties|null);

            /**
             * Creates a new S2C_MonsterMove instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_MonsterMove instance
             */
            static create(properties: jpt.base.S2C_MonsterMove.$Shape): jpt.base.S2C_MonsterMove & jpt.base.S2C_MonsterMove.$Shape;
            static create(properties?: jpt.base.S2C_MonsterMove.$Properties): jpt.base.S2C_MonsterMove;

            /**
             * Encodes the specified S2C_MonsterMove message. Does not implicitly {@link jpt.base.S2C_MonsterMove.verify|verify} messages.
             * @param message S2C_MonsterMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_MonsterMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_MonsterMove message, length delimited. Does not implicitly {@link jpt.base.S2C_MonsterMove.verify|verify} messages.
             * @param message S2C_MonsterMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_MonsterMove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_MonsterMove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_MonsterMove & jpt.base.S2C_MonsterMove.$Shape} S2C_MonsterMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_MonsterMove & jpt.base.S2C_MonsterMove.$Shape;

            /**
             * Decodes a S2C_MonsterMove message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_MonsterMove & jpt.base.S2C_MonsterMove.$Shape} S2C_MonsterMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_MonsterMove & jpt.base.S2C_MonsterMove.$Shape;

            /**
             * Verifies a S2C_MonsterMove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_MonsterMove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_MonsterMove
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_MonsterMove;

            /**
             * Creates a plain object from a S2C_MonsterMove message. Also converts values to other types if specified.
             * @param message S2C_MonsterMove
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_MonsterMove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_MonsterMove to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_MonsterMove
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_MonsterMove {

            /** Properties of a S2C_MonsterMove. */
            interface $Properties {

                /** S2C_MonsterMove monsterId */
                monsterId?: (number|Long|null);

                /** S2C_MonsterMove position */
                position?: (jpt.base.Position.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_MonsterMove. */
            type $Shape = jpt.base.S2C_MonsterMove.$Properties;
        }

        /**
         * Properties of a S2C_MonsterState.
         * @deprecated Use jpt.base.S2C_MonsterState.$Properties instead.
         */
        interface IS2C_MonsterState extends jpt.base.S2C_MonsterState.$Properties {
        }

        /** Represents a S2C_MonsterState. */
        class S2C_MonsterState {

            /**
             * Constructs a new S2C_MonsterState.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_MonsterState.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_MonsterState monsterId. */
            monsterId: (number|Long);

            /** S2C_MonsterState state. */
            state: jpt.base.MonsterState;

            /** S2C_MonsterState targetId. */
            targetId: (number|Long);

            /**
             * Creates a new S2C_MonsterState instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_MonsterState instance
             */
            static create(properties: jpt.base.S2C_MonsterState.$Shape): jpt.base.S2C_MonsterState & jpt.base.S2C_MonsterState.$Shape;
            static create(properties?: jpt.base.S2C_MonsterState.$Properties): jpt.base.S2C_MonsterState;

            /**
             * Encodes the specified S2C_MonsterState message. Does not implicitly {@link jpt.base.S2C_MonsterState.verify|verify} messages.
             * @param message S2C_MonsterState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_MonsterState.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_MonsterState message, length delimited. Does not implicitly {@link jpt.base.S2C_MonsterState.verify|verify} messages.
             * @param message S2C_MonsterState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_MonsterState.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_MonsterState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_MonsterState & jpt.base.S2C_MonsterState.$Shape} S2C_MonsterState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_MonsterState & jpt.base.S2C_MonsterState.$Shape;

            /**
             * Decodes a S2C_MonsterState message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_MonsterState & jpt.base.S2C_MonsterState.$Shape} S2C_MonsterState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_MonsterState & jpt.base.S2C_MonsterState.$Shape;

            /**
             * Verifies a S2C_MonsterState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_MonsterState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_MonsterState
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_MonsterState;

            /**
             * Creates a plain object from a S2C_MonsterState message. Also converts values to other types if specified.
             * @param message S2C_MonsterState
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_MonsterState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_MonsterState to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_MonsterState
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_MonsterState {

            /** Properties of a S2C_MonsterState. */
            interface $Properties {

                /** S2C_MonsterState monsterId */
                monsterId?: (number|Long|null);

                /** S2C_MonsterState state */
                state?: (jpt.base.MonsterState|null);

                /** S2C_MonsterState targetId */
                targetId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_MonsterState. */
            type $Shape = jpt.base.S2C_MonsterState.$Properties;
        }

        /**
         * Properties of a S2C_MonsterDeath.
         * @deprecated Use jpt.base.S2C_MonsterDeath.$Properties instead.
         */
        interface IS2C_MonsterDeath extends jpt.base.S2C_MonsterDeath.$Properties {
        }

        /** Represents a S2C_MonsterDeath. */
        class S2C_MonsterDeath {

            /**
             * Constructs a new S2C_MonsterDeath.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_MonsterDeath.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_MonsterDeath monsterId. */
            monsterId: (number|Long);

            /** S2C_MonsterDeath killerId. */
            killerId: (number|Long);

            /** S2C_MonsterDeath exp. */
            exp: number;

            /** S2C_MonsterDeath gold. */
            gold: number;

            /**
             * Creates a new S2C_MonsterDeath instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_MonsterDeath instance
             */
            static create(properties: jpt.base.S2C_MonsterDeath.$Shape): jpt.base.S2C_MonsterDeath & jpt.base.S2C_MonsterDeath.$Shape;
            static create(properties?: jpt.base.S2C_MonsterDeath.$Properties): jpt.base.S2C_MonsterDeath;

            /**
             * Encodes the specified S2C_MonsterDeath message. Does not implicitly {@link jpt.base.S2C_MonsterDeath.verify|verify} messages.
             * @param message S2C_MonsterDeath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_MonsterDeath.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_MonsterDeath message, length delimited. Does not implicitly {@link jpt.base.S2C_MonsterDeath.verify|verify} messages.
             * @param message S2C_MonsterDeath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_MonsterDeath.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_MonsterDeath message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_MonsterDeath & jpt.base.S2C_MonsterDeath.$Shape} S2C_MonsterDeath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_MonsterDeath & jpt.base.S2C_MonsterDeath.$Shape;

            /**
             * Decodes a S2C_MonsterDeath message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_MonsterDeath & jpt.base.S2C_MonsterDeath.$Shape} S2C_MonsterDeath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_MonsterDeath & jpt.base.S2C_MonsterDeath.$Shape;

            /**
             * Verifies a S2C_MonsterDeath message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_MonsterDeath message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_MonsterDeath
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_MonsterDeath;

            /**
             * Creates a plain object from a S2C_MonsterDeath message. Also converts values to other types if specified.
             * @param message S2C_MonsterDeath
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_MonsterDeath, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_MonsterDeath to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_MonsterDeath
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_MonsterDeath {

            /** Properties of a S2C_MonsterDeath. */
            interface $Properties {

                /** S2C_MonsterDeath monsterId */
                monsterId?: (number|Long|null);

                /** S2C_MonsterDeath killerId */
                killerId?: (number|Long|null);

                /** S2C_MonsterDeath exp */
                exp?: (number|null);

                /** S2C_MonsterDeath gold */
                gold?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_MonsterDeath. */
            type $Shape = jpt.base.S2C_MonsterDeath.$Properties;
        }

        /**
         * Properties of a C2S_Attack.
         * @deprecated Use jpt.base.C2S_Attack.$Properties instead.
         */
        interface IC2S_Attack extends jpt.base.C2S_Attack.$Properties {
        }

        /** Represents a C2S_Attack. */
        class C2S_Attack {

            /**
             * Constructs a new C2S_Attack.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_Attack.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_Attack targetId. */
            targetId: (number|Long);

            /**
             * Creates a new C2S_Attack instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_Attack instance
             */
            static create(properties: jpt.base.C2S_Attack.$Shape): jpt.base.C2S_Attack & jpt.base.C2S_Attack.$Shape;
            static create(properties?: jpt.base.C2S_Attack.$Properties): jpt.base.C2S_Attack;

            /**
             * Encodes the specified C2S_Attack message. Does not implicitly {@link jpt.base.C2S_Attack.verify|verify} messages.
             * @param message C2S_Attack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_Attack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_Attack message, length delimited. Does not implicitly {@link jpt.base.C2S_Attack.verify|verify} messages.
             * @param message C2S_Attack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_Attack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_Attack message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_Attack & jpt.base.C2S_Attack.$Shape} C2S_Attack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_Attack & jpt.base.C2S_Attack.$Shape;

            /**
             * Decodes a C2S_Attack message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_Attack & jpt.base.C2S_Attack.$Shape} C2S_Attack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_Attack & jpt.base.C2S_Attack.$Shape;

            /**
             * Verifies a C2S_Attack message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_Attack message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_Attack
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_Attack;

            /**
             * Creates a plain object from a C2S_Attack message. Also converts values to other types if specified.
             * @param message C2S_Attack
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_Attack, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_Attack to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_Attack
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_Attack {

            /** Properties of a C2S_Attack. */
            interface $Properties {

                /** C2S_Attack targetId */
                targetId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_Attack. */
            type $Shape = jpt.base.C2S_Attack.$Properties;
        }

        /**
         * Properties of a C2S_UseSkill.
         * @deprecated Use jpt.base.C2S_UseSkill.$Properties instead.
         */
        interface IC2S_UseSkill extends jpt.base.C2S_UseSkill.$Properties {
        }

        /** Represents a C2S_UseSkill. */
        class C2S_UseSkill {

            /**
             * Constructs a new C2S_UseSkill.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_UseSkill.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_UseSkill skillId. */
            skillId: number;

            /** C2S_UseSkill targetId. */
            targetId: (number|Long);

            /** C2S_UseSkill targetPosition. */
            targetPosition?: (jpt.base.Position.$Properties|null);

            /**
             * Creates a new C2S_UseSkill instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_UseSkill instance
             */
            static create(properties: jpt.base.C2S_UseSkill.$Shape): jpt.base.C2S_UseSkill & jpt.base.C2S_UseSkill.$Shape;
            static create(properties?: jpt.base.C2S_UseSkill.$Properties): jpt.base.C2S_UseSkill;

            /**
             * Encodes the specified C2S_UseSkill message. Does not implicitly {@link jpt.base.C2S_UseSkill.verify|verify} messages.
             * @param message C2S_UseSkill message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_UseSkill.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_UseSkill message, length delimited. Does not implicitly {@link jpt.base.C2S_UseSkill.verify|verify} messages.
             * @param message C2S_UseSkill message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_UseSkill.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_UseSkill message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_UseSkill & jpt.base.C2S_UseSkill.$Shape} C2S_UseSkill
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_UseSkill & jpt.base.C2S_UseSkill.$Shape;

            /**
             * Decodes a C2S_UseSkill message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_UseSkill & jpt.base.C2S_UseSkill.$Shape} C2S_UseSkill
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_UseSkill & jpt.base.C2S_UseSkill.$Shape;

            /**
             * Verifies a C2S_UseSkill message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_UseSkill message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_UseSkill
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_UseSkill;

            /**
             * Creates a plain object from a C2S_UseSkill message. Also converts values to other types if specified.
             * @param message C2S_UseSkill
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_UseSkill, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_UseSkill to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_UseSkill
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_UseSkill {

            /** Properties of a C2S_UseSkill. */
            interface $Properties {

                /** C2S_UseSkill skillId */
                skillId?: (number|null);

                /** C2S_UseSkill targetId */
                targetId?: (number|Long|null);

                /** C2S_UseSkill targetPosition */
                targetPosition?: (jpt.base.Position.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_UseSkill. */
            type $Shape = jpt.base.C2S_UseSkill.$Properties;
        }

        /**
         * Properties of a S2C_AttackResult.
         * @deprecated Use jpt.base.S2C_AttackResult.$Properties instead.
         */
        interface IS2C_AttackResult extends jpt.base.S2C_AttackResult.$Properties {
        }

        /** Represents a S2C_AttackResult. */
        class S2C_AttackResult {

            /**
             * Constructs a new S2C_AttackResult.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_AttackResult.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_AttackResult attackerId. */
            attackerId: (number|Long);

            /** S2C_AttackResult targetId. */
            targetId: (number|Long);

            /** S2C_AttackResult damage. */
            damage: number;

            /** S2C_AttackResult isCritical. */
            isCritical: boolean;

            /**
             * Creates a new S2C_AttackResult instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_AttackResult instance
             */
            static create(properties: jpt.base.S2C_AttackResult.$Shape): jpt.base.S2C_AttackResult & jpt.base.S2C_AttackResult.$Shape;
            static create(properties?: jpt.base.S2C_AttackResult.$Properties): jpt.base.S2C_AttackResult;

            /**
             * Encodes the specified S2C_AttackResult message. Does not implicitly {@link jpt.base.S2C_AttackResult.verify|verify} messages.
             * @param message S2C_AttackResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_AttackResult.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_AttackResult message, length delimited. Does not implicitly {@link jpt.base.S2C_AttackResult.verify|verify} messages.
             * @param message S2C_AttackResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_AttackResult.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_AttackResult message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_AttackResult & jpt.base.S2C_AttackResult.$Shape} S2C_AttackResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_AttackResult & jpt.base.S2C_AttackResult.$Shape;

            /**
             * Decodes a S2C_AttackResult message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_AttackResult & jpt.base.S2C_AttackResult.$Shape} S2C_AttackResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_AttackResult & jpt.base.S2C_AttackResult.$Shape;

            /**
             * Verifies a S2C_AttackResult message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_AttackResult message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_AttackResult
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_AttackResult;

            /**
             * Creates a plain object from a S2C_AttackResult message. Also converts values to other types if specified.
             * @param message S2C_AttackResult
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_AttackResult, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_AttackResult to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_AttackResult
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_AttackResult {

            /** Properties of a S2C_AttackResult. */
            interface $Properties {

                /** S2C_AttackResult attackerId */
                attackerId?: (number|Long|null);

                /** S2C_AttackResult targetId */
                targetId?: (number|Long|null);

                /** S2C_AttackResult damage */
                damage?: (number|null);

                /** S2C_AttackResult isCritical */
                isCritical?: (boolean|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_AttackResult. */
            type $Shape = jpt.base.S2C_AttackResult.$Properties;
        }

        /**
         * Properties of a S2C_SkillAttack.
         * @deprecated Use jpt.base.S2C_SkillAttack.$Properties instead.
         */
        interface IS2C_SkillAttack extends jpt.base.S2C_SkillAttack.$Properties {
        }

        /** Represents a S2C_SkillAttack. */
        class S2C_SkillAttack {

            /**
             * Constructs a new S2C_SkillAttack.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_SkillAttack.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_SkillAttack casterId. */
            casterId: (number|Long);

            /** S2C_SkillAttack skillId. */
            skillId: number;

            /** S2C_SkillAttack targetId. */
            targetId: (number|Long);

            /** S2C_SkillAttack damage. */
            damage: number;

            /**
             * Creates a new S2C_SkillAttack instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_SkillAttack instance
             */
            static create(properties: jpt.base.S2C_SkillAttack.$Shape): jpt.base.S2C_SkillAttack & jpt.base.S2C_SkillAttack.$Shape;
            static create(properties?: jpt.base.S2C_SkillAttack.$Properties): jpt.base.S2C_SkillAttack;

            /**
             * Encodes the specified S2C_SkillAttack message. Does not implicitly {@link jpt.base.S2C_SkillAttack.verify|verify} messages.
             * @param message S2C_SkillAttack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_SkillAttack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_SkillAttack message, length delimited. Does not implicitly {@link jpt.base.S2C_SkillAttack.verify|verify} messages.
             * @param message S2C_SkillAttack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_SkillAttack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_SkillAttack message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_SkillAttack & jpt.base.S2C_SkillAttack.$Shape} S2C_SkillAttack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_SkillAttack & jpt.base.S2C_SkillAttack.$Shape;

            /**
             * Decodes a S2C_SkillAttack message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_SkillAttack & jpt.base.S2C_SkillAttack.$Shape} S2C_SkillAttack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_SkillAttack & jpt.base.S2C_SkillAttack.$Shape;

            /**
             * Verifies a S2C_SkillAttack message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_SkillAttack message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_SkillAttack
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_SkillAttack;

            /**
             * Creates a plain object from a S2C_SkillAttack message. Also converts values to other types if specified.
             * @param message S2C_SkillAttack
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_SkillAttack, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_SkillAttack to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_SkillAttack
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_SkillAttack {

            /** Properties of a S2C_SkillAttack. */
            interface $Properties {

                /** S2C_SkillAttack casterId */
                casterId?: (number|Long|null);

                /** S2C_SkillAttack skillId */
                skillId?: (number|null);

                /** S2C_SkillAttack targetId */
                targetId?: (number|Long|null);

                /** S2C_SkillAttack damage */
                damage?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_SkillAttack. */
            type $Shape = jpt.base.S2C_SkillAttack.$Properties;
        }

        /**
         * Properties of a S2C_AoeAttack.
         * @deprecated Use jpt.base.S2C_AoeAttack.$Properties instead.
         */
        interface IS2C_AoeAttack extends jpt.base.S2C_AoeAttack.$Properties {
        }

        /** Represents a S2C_AoeAttack. */
        class S2C_AoeAttack {

            /**
             * Constructs a new S2C_AoeAttack.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_AoeAttack.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_AoeAttack casterId. */
            casterId: (number|Long);

            /** S2C_AoeAttack skillId. */
            skillId: number;

            /** S2C_AoeAttack position. */
            position?: (jpt.base.Position.$Properties|null);

            /** S2C_AoeAttack range. */
            range: number;

            /**
             * Creates a new S2C_AoeAttack instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_AoeAttack instance
             */
            static create(properties: jpt.base.S2C_AoeAttack.$Shape): jpt.base.S2C_AoeAttack & jpt.base.S2C_AoeAttack.$Shape;
            static create(properties?: jpt.base.S2C_AoeAttack.$Properties): jpt.base.S2C_AoeAttack;

            /**
             * Encodes the specified S2C_AoeAttack message. Does not implicitly {@link jpt.base.S2C_AoeAttack.verify|verify} messages.
             * @param message S2C_AoeAttack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_AoeAttack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_AoeAttack message, length delimited. Does not implicitly {@link jpt.base.S2C_AoeAttack.verify|verify} messages.
             * @param message S2C_AoeAttack message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_AoeAttack.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_AoeAttack message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_AoeAttack & jpt.base.S2C_AoeAttack.$Shape} S2C_AoeAttack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_AoeAttack & jpt.base.S2C_AoeAttack.$Shape;

            /**
             * Decodes a S2C_AoeAttack message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_AoeAttack & jpt.base.S2C_AoeAttack.$Shape} S2C_AoeAttack
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_AoeAttack & jpt.base.S2C_AoeAttack.$Shape;

            /**
             * Verifies a S2C_AoeAttack message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_AoeAttack message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_AoeAttack
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_AoeAttack;

            /**
             * Creates a plain object from a S2C_AoeAttack message. Also converts values to other types if specified.
             * @param message S2C_AoeAttack
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_AoeAttack, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_AoeAttack to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_AoeAttack
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_AoeAttack {

            /** Properties of a S2C_AoeAttack. */
            interface $Properties {

                /** S2C_AoeAttack casterId */
                casterId?: (number|Long|null);

                /** S2C_AoeAttack skillId */
                skillId?: (number|null);

                /** S2C_AoeAttack position */
                position?: (jpt.base.Position.$Properties|null);

                /** S2C_AoeAttack range */
                range?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_AoeAttack. */
            type $Shape = jpt.base.S2C_AoeAttack.$Properties;
        }

        /**
         * Properties of a S2C_Damage.
         * @deprecated Use jpt.base.S2C_Damage.$Properties instead.
         */
        interface IS2C_Damage extends jpt.base.S2C_Damage.$Properties {
        }

        /** Represents a S2C_Damage. */
        class S2C_Damage {

            /**
             * Constructs a new S2C_Damage.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Damage.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Damage targetId. */
            targetId: (number|Long);

            /** S2C_Damage damage. */
            damage: number;

            /** S2C_Damage currentHp. */
            currentHp: number;

            /**
             * Creates a new S2C_Damage instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Damage instance
             */
            static create(properties: jpt.base.S2C_Damage.$Shape): jpt.base.S2C_Damage & jpt.base.S2C_Damage.$Shape;
            static create(properties?: jpt.base.S2C_Damage.$Properties): jpt.base.S2C_Damage;

            /**
             * Encodes the specified S2C_Damage message. Does not implicitly {@link jpt.base.S2C_Damage.verify|verify} messages.
             * @param message S2C_Damage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Damage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Damage message, length delimited. Does not implicitly {@link jpt.base.S2C_Damage.verify|verify} messages.
             * @param message S2C_Damage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Damage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Damage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Damage & jpt.base.S2C_Damage.$Shape} S2C_Damage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Damage & jpt.base.S2C_Damage.$Shape;

            /**
             * Decodes a S2C_Damage message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Damage & jpt.base.S2C_Damage.$Shape} S2C_Damage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Damage & jpt.base.S2C_Damage.$Shape;

            /**
             * Verifies a S2C_Damage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Damage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Damage
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Damage;

            /**
             * Creates a plain object from a S2C_Damage message. Also converts values to other types if specified.
             * @param message S2C_Damage
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Damage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Damage to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Damage
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Damage {

            /** Properties of a S2C_Damage. */
            interface $Properties {

                /** S2C_Damage targetId */
                targetId?: (number|Long|null);

                /** S2C_Damage damage */
                damage?: (number|null);

                /** S2C_Damage currentHp */
                currentHp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Damage. */
            type $Shape = jpt.base.S2C_Damage.$Properties;
        }

        /**
         * Properties of a S2C_Heal.
         * @deprecated Use jpt.base.S2C_Heal.$Properties instead.
         */
        interface IS2C_Heal extends jpt.base.S2C_Heal.$Properties {
        }

        /** Represents a S2C_Heal. */
        class S2C_Heal {

            /**
             * Constructs a new S2C_Heal.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Heal.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Heal targetId. */
            targetId: (number|Long);

            /** S2C_Heal healAmount. */
            healAmount: number;

            /** S2C_Heal currentHp. */
            currentHp: number;

            /**
             * Creates a new S2C_Heal instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Heal instance
             */
            static create(properties: jpt.base.S2C_Heal.$Shape): jpt.base.S2C_Heal & jpt.base.S2C_Heal.$Shape;
            static create(properties?: jpt.base.S2C_Heal.$Properties): jpt.base.S2C_Heal;

            /**
             * Encodes the specified S2C_Heal message. Does not implicitly {@link jpt.base.S2C_Heal.verify|verify} messages.
             * @param message S2C_Heal message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Heal.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Heal message, length delimited. Does not implicitly {@link jpt.base.S2C_Heal.verify|verify} messages.
             * @param message S2C_Heal message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Heal.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Heal message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Heal & jpt.base.S2C_Heal.$Shape} S2C_Heal
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Heal & jpt.base.S2C_Heal.$Shape;

            /**
             * Decodes a S2C_Heal message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Heal & jpt.base.S2C_Heal.$Shape} S2C_Heal
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Heal & jpt.base.S2C_Heal.$Shape;

            /**
             * Verifies a S2C_Heal message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Heal message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Heal
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Heal;

            /**
             * Creates a plain object from a S2C_Heal message. Also converts values to other types if specified.
             * @param message S2C_Heal
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Heal, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Heal to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Heal
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Heal {

            /** Properties of a S2C_Heal. */
            interface $Properties {

                /** S2C_Heal targetId */
                targetId?: (number|Long|null);

                /** S2C_Heal healAmount */
                healAmount?: (number|null);

                /** S2C_Heal currentHp */
                currentHp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Heal. */
            type $Shape = jpt.base.S2C_Heal.$Properties;
        }

        /**
         * Properties of a S2C_BuffApply.
         * @deprecated Use jpt.base.S2C_BuffApply.$Properties instead.
         */
        interface IS2C_BuffApply extends jpt.base.S2C_BuffApply.$Properties {
        }

        /** Represents a S2C_BuffApply. */
        class S2C_BuffApply {

            /**
             * Constructs a new S2C_BuffApply.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_BuffApply.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_BuffApply entityId. */
            entityId: (number|Long);

            /** S2C_BuffApply buffId. */
            buffId: (number|Long);

            /** S2C_BuffApply skillId. */
            skillId: number;

            /** S2C_BuffApply duration. */
            duration: number;

            /** S2C_BuffApply effects. */
            effects: jpt.base.BuffEffectProto.$Properties[];

            /**
             * Creates a new S2C_BuffApply instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_BuffApply instance
             */
            static create(properties: jpt.base.S2C_BuffApply.$Shape): jpt.base.S2C_BuffApply & jpt.base.S2C_BuffApply.$Shape;
            static create(properties?: jpt.base.S2C_BuffApply.$Properties): jpt.base.S2C_BuffApply;

            /**
             * Encodes the specified S2C_BuffApply message. Does not implicitly {@link jpt.base.S2C_BuffApply.verify|verify} messages.
             * @param message S2C_BuffApply message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_BuffApply.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_BuffApply message, length delimited. Does not implicitly {@link jpt.base.S2C_BuffApply.verify|verify} messages.
             * @param message S2C_BuffApply message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_BuffApply.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_BuffApply message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_BuffApply & jpt.base.S2C_BuffApply.$Shape} S2C_BuffApply
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_BuffApply & jpt.base.S2C_BuffApply.$Shape;

            /**
             * Decodes a S2C_BuffApply message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_BuffApply & jpt.base.S2C_BuffApply.$Shape} S2C_BuffApply
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_BuffApply & jpt.base.S2C_BuffApply.$Shape;

            /**
             * Verifies a S2C_BuffApply message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_BuffApply message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_BuffApply
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_BuffApply;

            /**
             * Creates a plain object from a S2C_BuffApply message. Also converts values to other types if specified.
             * @param message S2C_BuffApply
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_BuffApply, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_BuffApply to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_BuffApply
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_BuffApply {

            /** Properties of a S2C_BuffApply. */
            interface $Properties {

                /** S2C_BuffApply entityId */
                entityId?: (number|Long|null);

                /** S2C_BuffApply buffId */
                buffId?: (number|Long|null);

                /** S2C_BuffApply skillId */
                skillId?: (number|null);

                /** S2C_BuffApply duration */
                duration?: (number|null);

                /** S2C_BuffApply effects */
                effects?: (jpt.base.BuffEffectProto.$Properties[]|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_BuffApply. */
            type $Shape = jpt.base.S2C_BuffApply.$Properties;
        }

        /**
         * Properties of a S2C_BuffRemove.
         * @deprecated Use jpt.base.S2C_BuffRemove.$Properties instead.
         */
        interface IS2C_BuffRemove extends jpt.base.S2C_BuffRemove.$Properties {
        }

        /** Represents a S2C_BuffRemove. */
        class S2C_BuffRemove {

            /**
             * Constructs a new S2C_BuffRemove.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_BuffRemove.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_BuffRemove entityId. */
            entityId: (number|Long);

            /** S2C_BuffRemove buffId. */
            buffId: (number|Long);

            /**
             * Creates a new S2C_BuffRemove instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_BuffRemove instance
             */
            static create(properties: jpt.base.S2C_BuffRemove.$Shape): jpt.base.S2C_BuffRemove & jpt.base.S2C_BuffRemove.$Shape;
            static create(properties?: jpt.base.S2C_BuffRemove.$Properties): jpt.base.S2C_BuffRemove;

            /**
             * Encodes the specified S2C_BuffRemove message. Does not implicitly {@link jpt.base.S2C_BuffRemove.verify|verify} messages.
             * @param message S2C_BuffRemove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_BuffRemove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_BuffRemove message, length delimited. Does not implicitly {@link jpt.base.S2C_BuffRemove.verify|verify} messages.
             * @param message S2C_BuffRemove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_BuffRemove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_BuffRemove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_BuffRemove & jpt.base.S2C_BuffRemove.$Shape} S2C_BuffRemove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_BuffRemove & jpt.base.S2C_BuffRemove.$Shape;

            /**
             * Decodes a S2C_BuffRemove message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_BuffRemove & jpt.base.S2C_BuffRemove.$Shape} S2C_BuffRemove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_BuffRemove & jpt.base.S2C_BuffRemove.$Shape;

            /**
             * Verifies a S2C_BuffRemove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_BuffRemove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_BuffRemove
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_BuffRemove;

            /**
             * Creates a plain object from a S2C_BuffRemove message. Also converts values to other types if specified.
             * @param message S2C_BuffRemove
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_BuffRemove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_BuffRemove to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_BuffRemove
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_BuffRemove {

            /** Properties of a S2C_BuffRemove. */
            interface $Properties {

                /** S2C_BuffRemove entityId */
                entityId?: (number|Long|null);

                /** S2C_BuffRemove buffId */
                buffId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_BuffRemove. */
            type $Shape = jpt.base.S2C_BuffRemove.$Properties;
        }

        /**
         * Properties of a S2C_ItemAdd.
         * @deprecated Use jpt.base.S2C_ItemAdd.$Properties instead.
         */
        interface IS2C_ItemAdd extends jpt.base.S2C_ItemAdd.$Properties {
        }

        /** Represents a S2C_ItemAdd. */
        class S2C_ItemAdd {

            /**
             * Constructs a new S2C_ItemAdd.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_ItemAdd.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_ItemAdd item. */
            item?: (jpt.base.ItemProto.$Properties|null);

            /**
             * Creates a new S2C_ItemAdd instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_ItemAdd instance
             */
            static create(properties: jpt.base.S2C_ItemAdd.$Shape): jpt.base.S2C_ItemAdd & jpt.base.S2C_ItemAdd.$Shape;
            static create(properties?: jpt.base.S2C_ItemAdd.$Properties): jpt.base.S2C_ItemAdd;

            /**
             * Encodes the specified S2C_ItemAdd message. Does not implicitly {@link jpt.base.S2C_ItemAdd.verify|verify} messages.
             * @param message S2C_ItemAdd message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_ItemAdd.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_ItemAdd message, length delimited. Does not implicitly {@link jpt.base.S2C_ItemAdd.verify|verify} messages.
             * @param message S2C_ItemAdd message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_ItemAdd.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_ItemAdd message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_ItemAdd & jpt.base.S2C_ItemAdd.$Shape} S2C_ItemAdd
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_ItemAdd & jpt.base.S2C_ItemAdd.$Shape;

            /**
             * Decodes a S2C_ItemAdd message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_ItemAdd & jpt.base.S2C_ItemAdd.$Shape} S2C_ItemAdd
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_ItemAdd & jpt.base.S2C_ItemAdd.$Shape;

            /**
             * Verifies a S2C_ItemAdd message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_ItemAdd message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_ItemAdd
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_ItemAdd;

            /**
             * Creates a plain object from a S2C_ItemAdd message. Also converts values to other types if specified.
             * @param message S2C_ItemAdd
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_ItemAdd, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_ItemAdd to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_ItemAdd
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_ItemAdd {

            /** Properties of a S2C_ItemAdd. */
            interface $Properties {

                /** S2C_ItemAdd item */
                item?: (jpt.base.ItemProto.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_ItemAdd. */
            type $Shape = jpt.base.S2C_ItemAdd.$Properties;
        }

        /**
         * Properties of a S2C_ItemRemove.
         * @deprecated Use jpt.base.S2C_ItemRemove.$Properties instead.
         */
        interface IS2C_ItemRemove extends jpt.base.S2C_ItemRemove.$Properties {
        }

        /** Represents a S2C_ItemRemove. */
        class S2C_ItemRemove {

            /**
             * Constructs a new S2C_ItemRemove.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_ItemRemove.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_ItemRemove itemId. */
            itemId: number;

            /** S2C_ItemRemove quantity. */
            quantity: number;

            /**
             * Creates a new S2C_ItemRemove instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_ItemRemove instance
             */
            static create(properties: jpt.base.S2C_ItemRemove.$Shape): jpt.base.S2C_ItemRemove & jpt.base.S2C_ItemRemove.$Shape;
            static create(properties?: jpt.base.S2C_ItemRemove.$Properties): jpt.base.S2C_ItemRemove;

            /**
             * Encodes the specified S2C_ItemRemove message. Does not implicitly {@link jpt.base.S2C_ItemRemove.verify|verify} messages.
             * @param message S2C_ItemRemove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_ItemRemove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_ItemRemove message, length delimited. Does not implicitly {@link jpt.base.S2C_ItemRemove.verify|verify} messages.
             * @param message S2C_ItemRemove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_ItemRemove.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_ItemRemove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_ItemRemove & jpt.base.S2C_ItemRemove.$Shape} S2C_ItemRemove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_ItemRemove & jpt.base.S2C_ItemRemove.$Shape;

            /**
             * Decodes a S2C_ItemRemove message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_ItemRemove & jpt.base.S2C_ItemRemove.$Shape} S2C_ItemRemove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_ItemRemove & jpt.base.S2C_ItemRemove.$Shape;

            /**
             * Verifies a S2C_ItemRemove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_ItemRemove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_ItemRemove
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_ItemRemove;

            /**
             * Creates a plain object from a S2C_ItemRemove message. Also converts values to other types if specified.
             * @param message S2C_ItemRemove
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_ItemRemove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_ItemRemove to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_ItemRemove
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_ItemRemove {

            /** Properties of a S2C_ItemRemove. */
            interface $Properties {

                /** S2C_ItemRemove itemId */
                itemId?: (number|null);

                /** S2C_ItemRemove quantity */
                quantity?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_ItemRemove. */
            type $Shape = jpt.base.S2C_ItemRemove.$Properties;
        }

        /**
         * Properties of a S2C_ItemUse.
         * @deprecated Use jpt.base.S2C_ItemUse.$Properties instead.
         */
        interface IS2C_ItemUse extends jpt.base.S2C_ItemUse.$Properties {
        }

        /** Represents a S2C_ItemUse. */
        class S2C_ItemUse {

            /**
             * Constructs a new S2C_ItemUse.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_ItemUse.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_ItemUse itemId. */
            itemId: number;

            /** S2C_ItemUse quantity. */
            quantity: number;

            /**
             * Creates a new S2C_ItemUse instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_ItemUse instance
             */
            static create(properties: jpt.base.S2C_ItemUse.$Shape): jpt.base.S2C_ItemUse & jpt.base.S2C_ItemUse.$Shape;
            static create(properties?: jpt.base.S2C_ItemUse.$Properties): jpt.base.S2C_ItemUse;

            /**
             * Encodes the specified S2C_ItemUse message. Does not implicitly {@link jpt.base.S2C_ItemUse.verify|verify} messages.
             * @param message S2C_ItemUse message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_ItemUse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_ItemUse message, length delimited. Does not implicitly {@link jpt.base.S2C_ItemUse.verify|verify} messages.
             * @param message S2C_ItemUse message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_ItemUse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_ItemUse message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_ItemUse & jpt.base.S2C_ItemUse.$Shape} S2C_ItemUse
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_ItemUse & jpt.base.S2C_ItemUse.$Shape;

            /**
             * Decodes a S2C_ItemUse message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_ItemUse & jpt.base.S2C_ItemUse.$Shape} S2C_ItemUse
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_ItemUse & jpt.base.S2C_ItemUse.$Shape;

            /**
             * Verifies a S2C_ItemUse message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_ItemUse message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_ItemUse
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_ItemUse;

            /**
             * Creates a plain object from a S2C_ItemUse message. Also converts values to other types if specified.
             * @param message S2C_ItemUse
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_ItemUse, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_ItemUse to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_ItemUse
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_ItemUse {

            /** Properties of a S2C_ItemUse. */
            interface $Properties {

                /** S2C_ItemUse itemId */
                itemId?: (number|null);

                /** S2C_ItemUse quantity */
                quantity?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_ItemUse. */
            type $Shape = jpt.base.S2C_ItemUse.$Properties;
        }

        /**
         * Properties of a S2C_GoldChange.
         * @deprecated Use jpt.base.S2C_GoldChange.$Properties instead.
         */
        interface IS2C_GoldChange extends jpt.base.S2C_GoldChange.$Properties {
        }

        /** Represents a S2C_GoldChange. */
        class S2C_GoldChange {

            /**
             * Constructs a new S2C_GoldChange.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_GoldChange.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_GoldChange oldGold. */
            oldGold: (number|Long);

            /** S2C_GoldChange newGold. */
            newGold: (number|Long);

            /** S2C_GoldChange reason. */
            reason: string;

            /**
             * Creates a new S2C_GoldChange instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_GoldChange instance
             */
            static create(properties: jpt.base.S2C_GoldChange.$Shape): jpt.base.S2C_GoldChange & jpt.base.S2C_GoldChange.$Shape;
            static create(properties?: jpt.base.S2C_GoldChange.$Properties): jpt.base.S2C_GoldChange;

            /**
             * Encodes the specified S2C_GoldChange message. Does not implicitly {@link jpt.base.S2C_GoldChange.verify|verify} messages.
             * @param message S2C_GoldChange message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_GoldChange.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_GoldChange message, length delimited. Does not implicitly {@link jpt.base.S2C_GoldChange.verify|verify} messages.
             * @param message S2C_GoldChange message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_GoldChange.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_GoldChange message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_GoldChange & jpt.base.S2C_GoldChange.$Shape} S2C_GoldChange
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_GoldChange & jpt.base.S2C_GoldChange.$Shape;

            /**
             * Decodes a S2C_GoldChange message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_GoldChange & jpt.base.S2C_GoldChange.$Shape} S2C_GoldChange
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_GoldChange & jpt.base.S2C_GoldChange.$Shape;

            /**
             * Verifies a S2C_GoldChange message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_GoldChange message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_GoldChange
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_GoldChange;

            /**
             * Creates a plain object from a S2C_GoldChange message. Also converts values to other types if specified.
             * @param message S2C_GoldChange
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_GoldChange, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_GoldChange to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_GoldChange
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_GoldChange {

            /** Properties of a S2C_GoldChange. */
            interface $Properties {

                /** S2C_GoldChange oldGold */
                oldGold?: (number|Long|null);

                /** S2C_GoldChange newGold */
                newGold?: (number|Long|null);

                /** S2C_GoldChange reason */
                reason?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_GoldChange. */
            type $Shape = jpt.base.S2C_GoldChange.$Properties;
        }

        /**
         * Properties of a S2C_GroundItemAppear.
         * @deprecated Use jpt.base.S2C_GroundItemAppear.$Properties instead.
         */
        interface IS2C_GroundItemAppear extends jpt.base.S2C_GroundItemAppear.$Properties {
        }

        /** Represents a S2C_GroundItemAppear. */
        class S2C_GroundItemAppear {

            /**
             * Constructs a new S2C_GroundItemAppear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_GroundItemAppear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_GroundItemAppear item. */
            item?: (jpt.base.GroundItemProto.$Properties|null);

            /**
             * Creates a new S2C_GroundItemAppear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_GroundItemAppear instance
             */
            static create(properties: jpt.base.S2C_GroundItemAppear.$Shape): jpt.base.S2C_GroundItemAppear & jpt.base.S2C_GroundItemAppear.$Shape;
            static create(properties?: jpt.base.S2C_GroundItemAppear.$Properties): jpt.base.S2C_GroundItemAppear;

            /**
             * Encodes the specified S2C_GroundItemAppear message. Does not implicitly {@link jpt.base.S2C_GroundItemAppear.verify|verify} messages.
             * @param message S2C_GroundItemAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_GroundItemAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_GroundItemAppear message, length delimited. Does not implicitly {@link jpt.base.S2C_GroundItemAppear.verify|verify} messages.
             * @param message S2C_GroundItemAppear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_GroundItemAppear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_GroundItemAppear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_GroundItemAppear & jpt.base.S2C_GroundItemAppear.$Shape} S2C_GroundItemAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_GroundItemAppear & jpt.base.S2C_GroundItemAppear.$Shape;

            /**
             * Decodes a S2C_GroundItemAppear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_GroundItemAppear & jpt.base.S2C_GroundItemAppear.$Shape} S2C_GroundItemAppear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_GroundItemAppear & jpt.base.S2C_GroundItemAppear.$Shape;

            /**
             * Verifies a S2C_GroundItemAppear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_GroundItemAppear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_GroundItemAppear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_GroundItemAppear;

            /**
             * Creates a plain object from a S2C_GroundItemAppear message. Also converts values to other types if specified.
             * @param message S2C_GroundItemAppear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_GroundItemAppear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_GroundItemAppear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_GroundItemAppear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_GroundItemAppear {

            /** Properties of a S2C_GroundItemAppear. */
            interface $Properties {

                /** S2C_GroundItemAppear item */
                item?: (jpt.base.GroundItemProto.$Properties|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_GroundItemAppear. */
            type $Shape = jpt.base.S2C_GroundItemAppear.$Properties;
        }

        /**
         * Properties of a S2C_GroundItemDisappear.
         * @deprecated Use jpt.base.S2C_GroundItemDisappear.$Properties instead.
         */
        interface IS2C_GroundItemDisappear extends jpt.base.S2C_GroundItemDisappear.$Properties {
        }

        /** Represents a S2C_GroundItemDisappear. */
        class S2C_GroundItemDisappear {

            /**
             * Constructs a new S2C_GroundItemDisappear.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_GroundItemDisappear.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_GroundItemDisappear groundItemId. */
            groundItemId: (number|Long);

            /**
             * Creates a new S2C_GroundItemDisappear instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_GroundItemDisappear instance
             */
            static create(properties: jpt.base.S2C_GroundItemDisappear.$Shape): jpt.base.S2C_GroundItemDisappear & jpt.base.S2C_GroundItemDisappear.$Shape;
            static create(properties?: jpt.base.S2C_GroundItemDisappear.$Properties): jpt.base.S2C_GroundItemDisappear;

            /**
             * Encodes the specified S2C_GroundItemDisappear message. Does not implicitly {@link jpt.base.S2C_GroundItemDisappear.verify|verify} messages.
             * @param message S2C_GroundItemDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_GroundItemDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_GroundItemDisappear message, length delimited. Does not implicitly {@link jpt.base.S2C_GroundItemDisappear.verify|verify} messages.
             * @param message S2C_GroundItemDisappear message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_GroundItemDisappear.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_GroundItemDisappear message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_GroundItemDisappear & jpt.base.S2C_GroundItemDisappear.$Shape} S2C_GroundItemDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_GroundItemDisappear & jpt.base.S2C_GroundItemDisappear.$Shape;

            /**
             * Decodes a S2C_GroundItemDisappear message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_GroundItemDisappear & jpt.base.S2C_GroundItemDisappear.$Shape} S2C_GroundItemDisappear
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_GroundItemDisappear & jpt.base.S2C_GroundItemDisappear.$Shape;

            /**
             * Verifies a S2C_GroundItemDisappear message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_GroundItemDisappear message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_GroundItemDisappear
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_GroundItemDisappear;

            /**
             * Creates a plain object from a S2C_GroundItemDisappear message. Also converts values to other types if specified.
             * @param message S2C_GroundItemDisappear
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_GroundItemDisappear, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_GroundItemDisappear to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_GroundItemDisappear
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_GroundItemDisappear {

            /** Properties of a S2C_GroundItemDisappear. */
            interface $Properties {

                /** S2C_GroundItemDisappear groundItemId */
                groundItemId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_GroundItemDisappear. */
            type $Shape = jpt.base.S2C_GroundItemDisappear.$Properties;
        }

        /**
         * Properties of a C2S_Chat.
         * @deprecated Use jpt.base.C2S_Chat.$Properties instead.
         */
        interface IC2S_Chat extends jpt.base.C2S_Chat.$Properties {
        }

        /** Represents a C2S_Chat. */
        class C2S_Chat {

            /**
             * Constructs a new C2S_Chat.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_Chat.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_Chat channel. */
            channel: jpt.base.ChatChannel;

            /** C2S_Chat message. */
            message: string;

            /** C2S_Chat targetName. */
            targetName: string;

            /**
             * Creates a new C2S_Chat instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_Chat instance
             */
            static create(properties: jpt.base.C2S_Chat.$Shape): jpt.base.C2S_Chat & jpt.base.C2S_Chat.$Shape;
            static create(properties?: jpt.base.C2S_Chat.$Properties): jpt.base.C2S_Chat;

            /**
             * Encodes the specified C2S_Chat message. Does not implicitly {@link jpt.base.C2S_Chat.verify|verify} messages.
             * @param message C2S_Chat message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_Chat.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_Chat message, length delimited. Does not implicitly {@link jpt.base.C2S_Chat.verify|verify} messages.
             * @param message C2S_Chat message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_Chat.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_Chat message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_Chat & jpt.base.C2S_Chat.$Shape} C2S_Chat
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_Chat & jpt.base.C2S_Chat.$Shape;

            /**
             * Decodes a C2S_Chat message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_Chat & jpt.base.C2S_Chat.$Shape} C2S_Chat
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_Chat & jpt.base.C2S_Chat.$Shape;

            /**
             * Verifies a C2S_Chat message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_Chat message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_Chat
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_Chat;

            /**
             * Creates a plain object from a C2S_Chat message. Also converts values to other types if specified.
             * @param message C2S_Chat
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_Chat, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_Chat to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_Chat
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_Chat {

            /** Properties of a C2S_Chat. */
            interface $Properties {

                /** C2S_Chat channel */
                channel?: (jpt.base.ChatChannel|null);

                /** C2S_Chat message */
                message?: (string|null);

                /** C2S_Chat targetName */
                targetName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_Chat. */
            type $Shape = jpt.base.C2S_Chat.$Properties;
        }

        /**
         * Properties of a C2S_TradeRequest.
         * @deprecated Use jpt.base.C2S_TradeRequest.$Properties instead.
         */
        interface IC2S_TradeRequest extends jpt.base.C2S_TradeRequest.$Properties {
        }

        /** Represents a C2S_TradeRequest. */
        class C2S_TradeRequest {

            /**
             * Constructs a new C2S_TradeRequest.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_TradeRequest.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_TradeRequest targetName. */
            targetName: string;

            /**
             * Creates a new C2S_TradeRequest instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_TradeRequest instance
             */
            static create(properties: jpt.base.C2S_TradeRequest.$Shape): jpt.base.C2S_TradeRequest & jpt.base.C2S_TradeRequest.$Shape;
            static create(properties?: jpt.base.C2S_TradeRequest.$Properties): jpt.base.C2S_TradeRequest;

            /**
             * Encodes the specified C2S_TradeRequest message. Does not implicitly {@link jpt.base.C2S_TradeRequest.verify|verify} messages.
             * @param message C2S_TradeRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_TradeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_TradeRequest message, length delimited. Does not implicitly {@link jpt.base.C2S_TradeRequest.verify|verify} messages.
             * @param message C2S_TradeRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_TradeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_TradeRequest message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_TradeRequest & jpt.base.C2S_TradeRequest.$Shape} C2S_TradeRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_TradeRequest & jpt.base.C2S_TradeRequest.$Shape;

            /**
             * Decodes a C2S_TradeRequest message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_TradeRequest & jpt.base.C2S_TradeRequest.$Shape} C2S_TradeRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_TradeRequest & jpt.base.C2S_TradeRequest.$Shape;

            /**
             * Verifies a C2S_TradeRequest message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_TradeRequest message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_TradeRequest
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_TradeRequest;

            /**
             * Creates a plain object from a C2S_TradeRequest message. Also converts values to other types if specified.
             * @param message C2S_TradeRequest
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_TradeRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_TradeRequest to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_TradeRequest
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_TradeRequest {

            /** Properties of a C2S_TradeRequest. */
            interface $Properties {

                /** C2S_TradeRequest targetName */
                targetName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_TradeRequest. */
            type $Shape = jpt.base.C2S_TradeRequest.$Properties;
        }

        /**
         * Properties of a C2S_TradeAccept.
         * @deprecated Use jpt.base.C2S_TradeAccept.$Properties instead.
         */
        interface IC2S_TradeAccept extends jpt.base.C2S_TradeAccept.$Properties {
        }

        /** Represents a C2S_TradeAccept. */
        class C2S_TradeAccept {

            /**
             * Constructs a new C2S_TradeAccept.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_TradeAccept.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_TradeAccept tradeId. */
            tradeId: (number|Long);

            /**
             * Creates a new C2S_TradeAccept instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_TradeAccept instance
             */
            static create(properties: jpt.base.C2S_TradeAccept.$Shape): jpt.base.C2S_TradeAccept & jpt.base.C2S_TradeAccept.$Shape;
            static create(properties?: jpt.base.C2S_TradeAccept.$Properties): jpt.base.C2S_TradeAccept;

            /**
             * Encodes the specified C2S_TradeAccept message. Does not implicitly {@link jpt.base.C2S_TradeAccept.verify|verify} messages.
             * @param message C2S_TradeAccept message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_TradeAccept.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_TradeAccept message, length delimited. Does not implicitly {@link jpt.base.C2S_TradeAccept.verify|verify} messages.
             * @param message C2S_TradeAccept message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_TradeAccept.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_TradeAccept message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_TradeAccept & jpt.base.C2S_TradeAccept.$Shape} C2S_TradeAccept
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_TradeAccept & jpt.base.C2S_TradeAccept.$Shape;

            /**
             * Decodes a C2S_TradeAccept message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_TradeAccept & jpt.base.C2S_TradeAccept.$Shape} C2S_TradeAccept
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_TradeAccept & jpt.base.C2S_TradeAccept.$Shape;

            /**
             * Verifies a C2S_TradeAccept message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_TradeAccept message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_TradeAccept
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_TradeAccept;

            /**
             * Creates a plain object from a C2S_TradeAccept message. Also converts values to other types if specified.
             * @param message C2S_TradeAccept
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_TradeAccept, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_TradeAccept to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_TradeAccept
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_TradeAccept {

            /** Properties of a C2S_TradeAccept. */
            interface $Properties {

                /** C2S_TradeAccept tradeId */
                tradeId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_TradeAccept. */
            type $Shape = jpt.base.C2S_TradeAccept.$Properties;
        }

        /**
         * Properties of a C2S_TradeAddItem.
         * @deprecated Use jpt.base.C2S_TradeAddItem.$Properties instead.
         */
        interface IC2S_TradeAddItem extends jpt.base.C2S_TradeAddItem.$Properties {
        }

        /** Represents a C2S_TradeAddItem. */
        class C2S_TradeAddItem {

            /**
             * Constructs a new C2S_TradeAddItem.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_TradeAddItem.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_TradeAddItem tradeId. */
            tradeId: (number|Long);

            /** C2S_TradeAddItem itemId. */
            itemId: number;

            /** C2S_TradeAddItem quantity. */
            quantity: number;

            /**
             * Creates a new C2S_TradeAddItem instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_TradeAddItem instance
             */
            static create(properties: jpt.base.C2S_TradeAddItem.$Shape): jpt.base.C2S_TradeAddItem & jpt.base.C2S_TradeAddItem.$Shape;
            static create(properties?: jpt.base.C2S_TradeAddItem.$Properties): jpt.base.C2S_TradeAddItem;

            /**
             * Encodes the specified C2S_TradeAddItem message. Does not implicitly {@link jpt.base.C2S_TradeAddItem.verify|verify} messages.
             * @param message C2S_TradeAddItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_TradeAddItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_TradeAddItem message, length delimited. Does not implicitly {@link jpt.base.C2S_TradeAddItem.verify|verify} messages.
             * @param message C2S_TradeAddItem message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_TradeAddItem.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_TradeAddItem message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_TradeAddItem & jpt.base.C2S_TradeAddItem.$Shape} C2S_TradeAddItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_TradeAddItem & jpt.base.C2S_TradeAddItem.$Shape;

            /**
             * Decodes a C2S_TradeAddItem message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_TradeAddItem & jpt.base.C2S_TradeAddItem.$Shape} C2S_TradeAddItem
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_TradeAddItem & jpt.base.C2S_TradeAddItem.$Shape;

            /**
             * Verifies a C2S_TradeAddItem message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_TradeAddItem message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_TradeAddItem
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_TradeAddItem;

            /**
             * Creates a plain object from a C2S_TradeAddItem message. Also converts values to other types if specified.
             * @param message C2S_TradeAddItem
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_TradeAddItem, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_TradeAddItem to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_TradeAddItem
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_TradeAddItem {

            /** Properties of a C2S_TradeAddItem. */
            interface $Properties {

                /** C2S_TradeAddItem tradeId */
                tradeId?: (number|Long|null);

                /** C2S_TradeAddItem itemId */
                itemId?: (number|null);

                /** C2S_TradeAddItem quantity */
                quantity?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_TradeAddItem. */
            type $Shape = jpt.base.C2S_TradeAddItem.$Properties;
        }

        /**
         * Properties of a C2S_TradeConfirm.
         * @deprecated Use jpt.base.C2S_TradeConfirm.$Properties instead.
         */
        interface IC2S_TradeConfirm extends jpt.base.C2S_TradeConfirm.$Properties {
        }

        /** Represents a C2S_TradeConfirm. */
        class C2S_TradeConfirm {

            /**
             * Constructs a new C2S_TradeConfirm.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_TradeConfirm.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_TradeConfirm tradeId. */
            tradeId: (number|Long);

            /**
             * Creates a new C2S_TradeConfirm instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_TradeConfirm instance
             */
            static create(properties: jpt.base.C2S_TradeConfirm.$Shape): jpt.base.C2S_TradeConfirm & jpt.base.C2S_TradeConfirm.$Shape;
            static create(properties?: jpt.base.C2S_TradeConfirm.$Properties): jpt.base.C2S_TradeConfirm;

            /**
             * Encodes the specified C2S_TradeConfirm message. Does not implicitly {@link jpt.base.C2S_TradeConfirm.verify|verify} messages.
             * @param message C2S_TradeConfirm message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_TradeConfirm.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_TradeConfirm message, length delimited. Does not implicitly {@link jpt.base.C2S_TradeConfirm.verify|verify} messages.
             * @param message C2S_TradeConfirm message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_TradeConfirm.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_TradeConfirm message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_TradeConfirm & jpt.base.C2S_TradeConfirm.$Shape} C2S_TradeConfirm
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_TradeConfirm & jpt.base.C2S_TradeConfirm.$Shape;

            /**
             * Decodes a C2S_TradeConfirm message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_TradeConfirm & jpt.base.C2S_TradeConfirm.$Shape} C2S_TradeConfirm
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_TradeConfirm & jpt.base.C2S_TradeConfirm.$Shape;

            /**
             * Verifies a C2S_TradeConfirm message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_TradeConfirm message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_TradeConfirm
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_TradeConfirm;

            /**
             * Creates a plain object from a C2S_TradeConfirm message. Also converts values to other types if specified.
             * @param message C2S_TradeConfirm
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_TradeConfirm, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_TradeConfirm to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_TradeConfirm
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_TradeConfirm {

            /** Properties of a C2S_TradeConfirm. */
            interface $Properties {

                /** C2S_TradeConfirm tradeId */
                tradeId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_TradeConfirm. */
            type $Shape = jpt.base.C2S_TradeConfirm.$Properties;
        }

        /**
         * Properties of a C2S_PartyInvite.
         * @deprecated Use jpt.base.C2S_PartyInvite.$Properties instead.
         */
        interface IC2S_PartyInvite extends jpt.base.C2S_PartyInvite.$Properties {
        }

        /** Represents a C2S_PartyInvite. */
        class C2S_PartyInvite {

            /**
             * Constructs a new C2S_PartyInvite.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PartyInvite.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_PartyInvite targetName. */
            targetName: string;

            /**
             * Creates a new C2S_PartyInvite instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PartyInvite instance
             */
            static create(properties: jpt.base.C2S_PartyInvite.$Shape): jpt.base.C2S_PartyInvite & jpt.base.C2S_PartyInvite.$Shape;
            static create(properties?: jpt.base.C2S_PartyInvite.$Properties): jpt.base.C2S_PartyInvite;

            /**
             * Encodes the specified C2S_PartyInvite message. Does not implicitly {@link jpt.base.C2S_PartyInvite.verify|verify} messages.
             * @param message C2S_PartyInvite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PartyInvite.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PartyInvite message, length delimited. Does not implicitly {@link jpt.base.C2S_PartyInvite.verify|verify} messages.
             * @param message C2S_PartyInvite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PartyInvite.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PartyInvite message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PartyInvite & jpt.base.C2S_PartyInvite.$Shape} C2S_PartyInvite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PartyInvite & jpt.base.C2S_PartyInvite.$Shape;

            /**
             * Decodes a C2S_PartyInvite message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PartyInvite & jpt.base.C2S_PartyInvite.$Shape} C2S_PartyInvite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PartyInvite & jpt.base.C2S_PartyInvite.$Shape;

            /**
             * Verifies a C2S_PartyInvite message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PartyInvite message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PartyInvite
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PartyInvite;

            /**
             * Creates a plain object from a C2S_PartyInvite message. Also converts values to other types if specified.
             * @param message C2S_PartyInvite
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PartyInvite, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PartyInvite to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PartyInvite
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PartyInvite {

            /** Properties of a C2S_PartyInvite. */
            interface $Properties {

                /** C2S_PartyInvite targetName */
                targetName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PartyInvite. */
            type $Shape = jpt.base.C2S_PartyInvite.$Properties;
        }

        /**
         * Properties of a C2S_PartyAccept.
         * @deprecated Use jpt.base.C2S_PartyAccept.$Properties instead.
         */
        interface IC2S_PartyAccept extends jpt.base.C2S_PartyAccept.$Properties {
        }

        /** Represents a C2S_PartyAccept. */
        class C2S_PartyAccept {

            /**
             * Constructs a new C2S_PartyAccept.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PartyAccept.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_PartyAccept partyId. */
            partyId: (number|Long);

            /**
             * Creates a new C2S_PartyAccept instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PartyAccept instance
             */
            static create(properties: jpt.base.C2S_PartyAccept.$Shape): jpt.base.C2S_PartyAccept & jpt.base.C2S_PartyAccept.$Shape;
            static create(properties?: jpt.base.C2S_PartyAccept.$Properties): jpt.base.C2S_PartyAccept;

            /**
             * Encodes the specified C2S_PartyAccept message. Does not implicitly {@link jpt.base.C2S_PartyAccept.verify|verify} messages.
             * @param message C2S_PartyAccept message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PartyAccept.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PartyAccept message, length delimited. Does not implicitly {@link jpt.base.C2S_PartyAccept.verify|verify} messages.
             * @param message C2S_PartyAccept message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PartyAccept.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PartyAccept message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PartyAccept & jpt.base.C2S_PartyAccept.$Shape} C2S_PartyAccept
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PartyAccept & jpt.base.C2S_PartyAccept.$Shape;

            /**
             * Decodes a C2S_PartyAccept message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PartyAccept & jpt.base.C2S_PartyAccept.$Shape} C2S_PartyAccept
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PartyAccept & jpt.base.C2S_PartyAccept.$Shape;

            /**
             * Verifies a C2S_PartyAccept message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PartyAccept message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PartyAccept
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PartyAccept;

            /**
             * Creates a plain object from a C2S_PartyAccept message. Also converts values to other types if specified.
             * @param message C2S_PartyAccept
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PartyAccept, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PartyAccept to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PartyAccept
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PartyAccept {

            /** Properties of a C2S_PartyAccept. */
            interface $Properties {

                /** C2S_PartyAccept partyId */
                partyId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PartyAccept. */
            type $Shape = jpt.base.C2S_PartyAccept.$Properties;
        }

        /**
         * Properties of a C2S_PartyLeave.
         * @deprecated Use jpt.base.C2S_PartyLeave.$Properties instead.
         */
        interface IC2S_PartyLeave extends jpt.base.C2S_PartyLeave.$Properties {
        }

        /** Represents a C2S_PartyLeave. */
        class C2S_PartyLeave {

            /**
             * Constructs a new C2S_PartyLeave.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_PartyLeave.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /**
             * Creates a new C2S_PartyLeave instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_PartyLeave instance
             */
            static create(properties: jpt.base.C2S_PartyLeave.$Shape): jpt.base.C2S_PartyLeave & jpt.base.C2S_PartyLeave.$Shape;
            static create(properties?: jpt.base.C2S_PartyLeave.$Properties): jpt.base.C2S_PartyLeave;

            /**
             * Encodes the specified C2S_PartyLeave message. Does not implicitly {@link jpt.base.C2S_PartyLeave.verify|verify} messages.
             * @param message C2S_PartyLeave message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_PartyLeave.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_PartyLeave message, length delimited. Does not implicitly {@link jpt.base.C2S_PartyLeave.verify|verify} messages.
             * @param message C2S_PartyLeave message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_PartyLeave.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_PartyLeave message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_PartyLeave & jpt.base.C2S_PartyLeave.$Shape} C2S_PartyLeave
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_PartyLeave & jpt.base.C2S_PartyLeave.$Shape;

            /**
             * Decodes a C2S_PartyLeave message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_PartyLeave & jpt.base.C2S_PartyLeave.$Shape} C2S_PartyLeave
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_PartyLeave & jpt.base.C2S_PartyLeave.$Shape;

            /**
             * Verifies a C2S_PartyLeave message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_PartyLeave message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_PartyLeave
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_PartyLeave;

            /**
             * Creates a plain object from a C2S_PartyLeave message. Also converts values to other types if specified.
             * @param message C2S_PartyLeave
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_PartyLeave, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_PartyLeave to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_PartyLeave
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_PartyLeave {

            /** Properties of a C2S_PartyLeave. */
            interface $Properties {

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_PartyLeave. */
            type $Shape = jpt.base.C2S_PartyLeave.$Properties;
        }

        /**
         * Properties of a S2C_Chat.
         * @deprecated Use jpt.base.S2C_Chat.$Properties instead.
         */
        interface IS2C_Chat extends jpt.base.S2C_Chat.$Properties {
        }

        /** Represents a S2C_Chat. */
        class S2C_Chat {

            /**
             * Constructs a new S2C_Chat.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Chat.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Chat channel. */
            channel: jpt.base.ChatChannel;

            /** S2C_Chat senderId. */
            senderId: (number|Long);

            /** S2C_Chat senderName. */
            senderName: string;

            /** S2C_Chat message. */
            message: string;

            /** S2C_Chat timestamp. */
            timestamp: (number|Long);

            /**
             * Creates a new S2C_Chat instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Chat instance
             */
            static create(properties: jpt.base.S2C_Chat.$Shape): jpt.base.S2C_Chat & jpt.base.S2C_Chat.$Shape;
            static create(properties?: jpt.base.S2C_Chat.$Properties): jpt.base.S2C_Chat;

            /**
             * Encodes the specified S2C_Chat message. Does not implicitly {@link jpt.base.S2C_Chat.verify|verify} messages.
             * @param message S2C_Chat message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Chat.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Chat message, length delimited. Does not implicitly {@link jpt.base.S2C_Chat.verify|verify} messages.
             * @param message S2C_Chat message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Chat.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Chat message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Chat & jpt.base.S2C_Chat.$Shape} S2C_Chat
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Chat & jpt.base.S2C_Chat.$Shape;

            /**
             * Decodes a S2C_Chat message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Chat & jpt.base.S2C_Chat.$Shape} S2C_Chat
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Chat & jpt.base.S2C_Chat.$Shape;

            /**
             * Verifies a S2C_Chat message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Chat message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Chat
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Chat;

            /**
             * Creates a plain object from a S2C_Chat message. Also converts values to other types if specified.
             * @param message S2C_Chat
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Chat, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Chat to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Chat
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Chat {

            /** Properties of a S2C_Chat. */
            interface $Properties {

                /** S2C_Chat channel */
                channel?: (jpt.base.ChatChannel|null);

                /** S2C_Chat senderId */
                senderId?: (number|Long|null);

                /** S2C_Chat senderName */
                senderName?: (string|null);

                /** S2C_Chat message */
                message?: (string|null);

                /** S2C_Chat timestamp */
                timestamp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Chat. */
            type $Shape = jpt.base.S2C_Chat.$Properties;
        }

        /**
         * Properties of a S2C_TradeRequest.
         * @deprecated Use jpt.base.S2C_TradeRequest.$Properties instead.
         */
        interface IS2C_TradeRequest extends jpt.base.S2C_TradeRequest.$Properties {
        }

        /** Represents a S2C_TradeRequest. */
        class S2C_TradeRequest {

            /**
             * Constructs a new S2C_TradeRequest.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_TradeRequest.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_TradeRequest tradeId. */
            tradeId: (number|Long);

            /** S2C_TradeRequest requesterId. */
            requesterId: (number|Long);

            /** S2C_TradeRequest requesterName. */
            requesterName: string;

            /**
             * Creates a new S2C_TradeRequest instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_TradeRequest instance
             */
            static create(properties: jpt.base.S2C_TradeRequest.$Shape): jpt.base.S2C_TradeRequest & jpt.base.S2C_TradeRequest.$Shape;
            static create(properties?: jpt.base.S2C_TradeRequest.$Properties): jpt.base.S2C_TradeRequest;

            /**
             * Encodes the specified S2C_TradeRequest message. Does not implicitly {@link jpt.base.S2C_TradeRequest.verify|verify} messages.
             * @param message S2C_TradeRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_TradeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_TradeRequest message, length delimited. Does not implicitly {@link jpt.base.S2C_TradeRequest.verify|verify} messages.
             * @param message S2C_TradeRequest message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_TradeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_TradeRequest message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_TradeRequest & jpt.base.S2C_TradeRequest.$Shape} S2C_TradeRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_TradeRequest & jpt.base.S2C_TradeRequest.$Shape;

            /**
             * Decodes a S2C_TradeRequest message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_TradeRequest & jpt.base.S2C_TradeRequest.$Shape} S2C_TradeRequest
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_TradeRequest & jpt.base.S2C_TradeRequest.$Shape;

            /**
             * Verifies a S2C_TradeRequest message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_TradeRequest message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_TradeRequest
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_TradeRequest;

            /**
             * Creates a plain object from a S2C_TradeRequest message. Also converts values to other types if specified.
             * @param message S2C_TradeRequest
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_TradeRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_TradeRequest to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_TradeRequest
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_TradeRequest {

            /** Properties of a S2C_TradeRequest. */
            interface $Properties {

                /** S2C_TradeRequest tradeId */
                tradeId?: (number|Long|null);

                /** S2C_TradeRequest requesterId */
                requesterId?: (number|Long|null);

                /** S2C_TradeRequest requesterName */
                requesterName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_TradeRequest. */
            type $Shape = jpt.base.S2C_TradeRequest.$Properties;
        }

        /**
         * Properties of a S2C_TradeOpen.
         * @deprecated Use jpt.base.S2C_TradeOpen.$Properties instead.
         */
        interface IS2C_TradeOpen extends jpt.base.S2C_TradeOpen.$Properties {
        }

        /** Represents a S2C_TradeOpen. */
        class S2C_TradeOpen {

            /**
             * Constructs a new S2C_TradeOpen.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_TradeOpen.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_TradeOpen tradeId. */
            tradeId: (number|Long);

            /**
             * Creates a new S2C_TradeOpen instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_TradeOpen instance
             */
            static create(properties: jpt.base.S2C_TradeOpen.$Shape): jpt.base.S2C_TradeOpen & jpt.base.S2C_TradeOpen.$Shape;
            static create(properties?: jpt.base.S2C_TradeOpen.$Properties): jpt.base.S2C_TradeOpen;

            /**
             * Encodes the specified S2C_TradeOpen message. Does not implicitly {@link jpt.base.S2C_TradeOpen.verify|verify} messages.
             * @param message S2C_TradeOpen message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_TradeOpen.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_TradeOpen message, length delimited. Does not implicitly {@link jpt.base.S2C_TradeOpen.verify|verify} messages.
             * @param message S2C_TradeOpen message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_TradeOpen.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_TradeOpen message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_TradeOpen & jpt.base.S2C_TradeOpen.$Shape} S2C_TradeOpen
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_TradeOpen & jpt.base.S2C_TradeOpen.$Shape;

            /**
             * Decodes a S2C_TradeOpen message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_TradeOpen & jpt.base.S2C_TradeOpen.$Shape} S2C_TradeOpen
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_TradeOpen & jpt.base.S2C_TradeOpen.$Shape;

            /**
             * Verifies a S2C_TradeOpen message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_TradeOpen message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_TradeOpen
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_TradeOpen;

            /**
             * Creates a plain object from a S2C_TradeOpen message. Also converts values to other types if specified.
             * @param message S2C_TradeOpen
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_TradeOpen, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_TradeOpen to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_TradeOpen
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_TradeOpen {

            /** Properties of a S2C_TradeOpen. */
            interface $Properties {

                /** S2C_TradeOpen tradeId */
                tradeId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_TradeOpen. */
            type $Shape = jpt.base.S2C_TradeOpen.$Properties;
        }

        /**
         * Properties of a S2C_TradeUpdate.
         * @deprecated Use jpt.base.S2C_TradeUpdate.$Properties instead.
         */
        interface IS2C_TradeUpdate extends jpt.base.S2C_TradeUpdate.$Properties {
        }

        /** Represents a S2C_TradeUpdate. */
        class S2C_TradeUpdate {

            /**
             * Constructs a new S2C_TradeUpdate.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_TradeUpdate.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_TradeUpdate tradeId. */
            tradeId: (number|Long);

            /**
             * Creates a new S2C_TradeUpdate instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_TradeUpdate instance
             */
            static create(properties: jpt.base.S2C_TradeUpdate.$Shape): jpt.base.S2C_TradeUpdate & jpt.base.S2C_TradeUpdate.$Shape;
            static create(properties?: jpt.base.S2C_TradeUpdate.$Properties): jpt.base.S2C_TradeUpdate;

            /**
             * Encodes the specified S2C_TradeUpdate message. Does not implicitly {@link jpt.base.S2C_TradeUpdate.verify|verify} messages.
             * @param message S2C_TradeUpdate message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_TradeUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_TradeUpdate message, length delimited. Does not implicitly {@link jpt.base.S2C_TradeUpdate.verify|verify} messages.
             * @param message S2C_TradeUpdate message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_TradeUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_TradeUpdate message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_TradeUpdate & jpt.base.S2C_TradeUpdate.$Shape} S2C_TradeUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_TradeUpdate & jpt.base.S2C_TradeUpdate.$Shape;

            /**
             * Decodes a S2C_TradeUpdate message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_TradeUpdate & jpt.base.S2C_TradeUpdate.$Shape} S2C_TradeUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_TradeUpdate & jpt.base.S2C_TradeUpdate.$Shape;

            /**
             * Verifies a S2C_TradeUpdate message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_TradeUpdate message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_TradeUpdate
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_TradeUpdate;

            /**
             * Creates a plain object from a S2C_TradeUpdate message. Also converts values to other types if specified.
             * @param message S2C_TradeUpdate
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_TradeUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_TradeUpdate to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_TradeUpdate
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_TradeUpdate {

            /** Properties of a S2C_TradeUpdate. */
            interface $Properties {

                /** S2C_TradeUpdate tradeId */
                tradeId?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_TradeUpdate. */
            type $Shape = jpt.base.S2C_TradeUpdate.$Properties;
        }

        /**
         * Properties of a S2C_TradeComplete.
         * @deprecated Use jpt.base.S2C_TradeComplete.$Properties instead.
         */
        interface IS2C_TradeComplete extends jpt.base.S2C_TradeComplete.$Properties {
        }

        /** Represents a S2C_TradeComplete. */
        class S2C_TradeComplete {

            /**
             * Constructs a new S2C_TradeComplete.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_TradeComplete.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_TradeComplete success. */
            success: boolean;

            /** S2C_TradeComplete message. */
            message: string;

            /**
             * Creates a new S2C_TradeComplete instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_TradeComplete instance
             */
            static create(properties: jpt.base.S2C_TradeComplete.$Shape): jpt.base.S2C_TradeComplete & jpt.base.S2C_TradeComplete.$Shape;
            static create(properties?: jpt.base.S2C_TradeComplete.$Properties): jpt.base.S2C_TradeComplete;

            /**
             * Encodes the specified S2C_TradeComplete message. Does not implicitly {@link jpt.base.S2C_TradeComplete.verify|verify} messages.
             * @param message S2C_TradeComplete message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_TradeComplete.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_TradeComplete message, length delimited. Does not implicitly {@link jpt.base.S2C_TradeComplete.verify|verify} messages.
             * @param message S2C_TradeComplete message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_TradeComplete.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_TradeComplete message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_TradeComplete & jpt.base.S2C_TradeComplete.$Shape} S2C_TradeComplete
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_TradeComplete & jpt.base.S2C_TradeComplete.$Shape;

            /**
             * Decodes a S2C_TradeComplete message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_TradeComplete & jpt.base.S2C_TradeComplete.$Shape} S2C_TradeComplete
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_TradeComplete & jpt.base.S2C_TradeComplete.$Shape;

            /**
             * Verifies a S2C_TradeComplete message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_TradeComplete message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_TradeComplete
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_TradeComplete;

            /**
             * Creates a plain object from a S2C_TradeComplete message. Also converts values to other types if specified.
             * @param message S2C_TradeComplete
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_TradeComplete, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_TradeComplete to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_TradeComplete
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_TradeComplete {

            /** Properties of a S2C_TradeComplete. */
            interface $Properties {

                /** S2C_TradeComplete success */
                success?: (boolean|null);

                /** S2C_TradeComplete message */
                message?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_TradeComplete. */
            type $Shape = jpt.base.S2C_TradeComplete.$Properties;
        }

        /**
         * Properties of a S2C_PartyUpdate.
         * @deprecated Use jpt.base.S2C_PartyUpdate.$Properties instead.
         */
        interface IS2C_PartyUpdate extends jpt.base.S2C_PartyUpdate.$Properties {
        }

        /** Represents a S2C_PartyUpdate. */
        class S2C_PartyUpdate {

            /**
             * Constructs a new S2C_PartyUpdate.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PartyUpdate.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PartyUpdate partyId. */
            partyId: (number|Long);

            /** S2C_PartyUpdate leaderId. */
            leaderId: (number|Long);

            /** S2C_PartyUpdate memberIds. */
            memberIds: (number|Long)[];

            /**
             * Creates a new S2C_PartyUpdate instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PartyUpdate instance
             */
            static create(properties: jpt.base.S2C_PartyUpdate.$Shape): jpt.base.S2C_PartyUpdate & jpt.base.S2C_PartyUpdate.$Shape;
            static create(properties?: jpt.base.S2C_PartyUpdate.$Properties): jpt.base.S2C_PartyUpdate;

            /**
             * Encodes the specified S2C_PartyUpdate message. Does not implicitly {@link jpt.base.S2C_PartyUpdate.verify|verify} messages.
             * @param message S2C_PartyUpdate message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PartyUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PartyUpdate message, length delimited. Does not implicitly {@link jpt.base.S2C_PartyUpdate.verify|verify} messages.
             * @param message S2C_PartyUpdate message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PartyUpdate.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PartyUpdate message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PartyUpdate & jpt.base.S2C_PartyUpdate.$Shape} S2C_PartyUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PartyUpdate & jpt.base.S2C_PartyUpdate.$Shape;

            /**
             * Decodes a S2C_PartyUpdate message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PartyUpdate & jpt.base.S2C_PartyUpdate.$Shape} S2C_PartyUpdate
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PartyUpdate & jpt.base.S2C_PartyUpdate.$Shape;

            /**
             * Verifies a S2C_PartyUpdate message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PartyUpdate message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PartyUpdate
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PartyUpdate;

            /**
             * Creates a plain object from a S2C_PartyUpdate message. Also converts values to other types if specified.
             * @param message S2C_PartyUpdate
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PartyUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PartyUpdate to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PartyUpdate
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PartyUpdate {

            /** Properties of a S2C_PartyUpdate. */
            interface $Properties {

                /** S2C_PartyUpdate partyId */
                partyId?: (number|Long|null);

                /** S2C_PartyUpdate leaderId */
                leaderId?: (number|Long|null);

                /** S2C_PartyUpdate memberIds */
                memberIds?: ((number|Long)[]|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PartyUpdate. */
            type $Shape = jpt.base.S2C_PartyUpdate.$Properties;
        }

        /**
         * Properties of a S2C_PartyInvite.
         * @deprecated Use jpt.base.S2C_PartyInvite.$Properties instead.
         */
        interface IS2C_PartyInvite extends jpt.base.S2C_PartyInvite.$Properties {
        }

        /** Represents a S2C_PartyInvite. */
        class S2C_PartyInvite {

            /**
             * Constructs a new S2C_PartyInvite.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_PartyInvite.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_PartyInvite partyId. */
            partyId: (number|Long);

            /** S2C_PartyInvite inviterId. */
            inviterId: (number|Long);

            /** S2C_PartyInvite inviterName. */
            inviterName: string;

            /**
             * Creates a new S2C_PartyInvite instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_PartyInvite instance
             */
            static create(properties: jpt.base.S2C_PartyInvite.$Shape): jpt.base.S2C_PartyInvite & jpt.base.S2C_PartyInvite.$Shape;
            static create(properties?: jpt.base.S2C_PartyInvite.$Properties): jpt.base.S2C_PartyInvite;

            /**
             * Encodes the specified S2C_PartyInvite message. Does not implicitly {@link jpt.base.S2C_PartyInvite.verify|verify} messages.
             * @param message S2C_PartyInvite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_PartyInvite.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_PartyInvite message, length delimited. Does not implicitly {@link jpt.base.S2C_PartyInvite.verify|verify} messages.
             * @param message S2C_PartyInvite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_PartyInvite.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_PartyInvite message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_PartyInvite & jpt.base.S2C_PartyInvite.$Shape} S2C_PartyInvite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_PartyInvite & jpt.base.S2C_PartyInvite.$Shape;

            /**
             * Decodes a S2C_PartyInvite message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_PartyInvite & jpt.base.S2C_PartyInvite.$Shape} S2C_PartyInvite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_PartyInvite & jpt.base.S2C_PartyInvite.$Shape;

            /**
             * Verifies a S2C_PartyInvite message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_PartyInvite message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_PartyInvite
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_PartyInvite;

            /**
             * Creates a plain object from a S2C_PartyInvite message. Also converts values to other types if specified.
             * @param message S2C_PartyInvite
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_PartyInvite, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_PartyInvite to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_PartyInvite
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_PartyInvite {

            /** Properties of a S2C_PartyInvite. */
            interface $Properties {

                /** S2C_PartyInvite partyId */
                partyId?: (number|Long|null);

                /** S2C_PartyInvite inviterId */
                inviterId?: (number|Long|null);

                /** S2C_PartyInvite inviterName */
                inviterName?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_PartyInvite. */
            type $Shape = jpt.base.S2C_PartyInvite.$Properties;
        }

        /**
         * Properties of a C2S_Ping.
         * @deprecated Use jpt.base.C2S_Ping.$Properties instead.
         */
        interface IC2S_Ping extends jpt.base.C2S_Ping.$Properties {
        }

        /** Represents a C2S_Ping. */
        class C2S_Ping {

            /**
             * Constructs a new C2S_Ping.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.C2S_Ping.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** C2S_Ping timestamp. */
            timestamp: (number|Long);

            /**
             * Creates a new C2S_Ping instance using the specified properties.
             * @param [properties] Properties to set
             * @returns C2S_Ping instance
             */
            static create(properties: jpt.base.C2S_Ping.$Shape): jpt.base.C2S_Ping & jpt.base.C2S_Ping.$Shape;
            static create(properties?: jpt.base.C2S_Ping.$Properties): jpt.base.C2S_Ping;

            /**
             * Encodes the specified C2S_Ping message. Does not implicitly {@link jpt.base.C2S_Ping.verify|verify} messages.
             * @param message C2S_Ping message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.C2S_Ping.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified C2S_Ping message, length delimited. Does not implicitly {@link jpt.base.C2S_Ping.verify|verify} messages.
             * @param message C2S_Ping message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.C2S_Ping.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a C2S_Ping message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.C2S_Ping & jpt.base.C2S_Ping.$Shape} C2S_Ping
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.C2S_Ping & jpt.base.C2S_Ping.$Shape;

            /**
             * Decodes a C2S_Ping message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.C2S_Ping & jpt.base.C2S_Ping.$Shape} C2S_Ping
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.C2S_Ping & jpt.base.C2S_Ping.$Shape;

            /**
             * Verifies a C2S_Ping message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a C2S_Ping message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns C2S_Ping
             */
            static fromObject(object: { [k: string]: any }): jpt.base.C2S_Ping;

            /**
             * Creates a plain object from a C2S_Ping message. Also converts values to other types if specified.
             * @param message C2S_Ping
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.C2S_Ping, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this C2S_Ping to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for C2S_Ping
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace C2S_Ping {

            /** Properties of a C2S_Ping. */
            interface $Properties {

                /** C2S_Ping timestamp */
                timestamp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a C2S_Ping. */
            type $Shape = jpt.base.C2S_Ping.$Properties;
        }

        /**
         * Properties of a S2C_Pong.
         * @deprecated Use jpt.base.S2C_Pong.$Properties instead.
         */
        interface IS2C_Pong extends jpt.base.S2C_Pong.$Properties {
        }

        /** Represents a S2C_Pong. */
        class S2C_Pong {

            /**
             * Constructs a new S2C_Pong.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Pong.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Pong timestamp. */
            timestamp: (number|Long);

            /**
             * Creates a new S2C_Pong instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Pong instance
             */
            static create(properties: jpt.base.S2C_Pong.$Shape): jpt.base.S2C_Pong & jpt.base.S2C_Pong.$Shape;
            static create(properties?: jpt.base.S2C_Pong.$Properties): jpt.base.S2C_Pong;

            /**
             * Encodes the specified S2C_Pong message. Does not implicitly {@link jpt.base.S2C_Pong.verify|verify} messages.
             * @param message S2C_Pong message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Pong.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Pong message, length delimited. Does not implicitly {@link jpt.base.S2C_Pong.verify|verify} messages.
             * @param message S2C_Pong message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Pong.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Pong message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Pong & jpt.base.S2C_Pong.$Shape} S2C_Pong
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Pong & jpt.base.S2C_Pong.$Shape;

            /**
             * Decodes a S2C_Pong message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Pong & jpt.base.S2C_Pong.$Shape} S2C_Pong
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Pong & jpt.base.S2C_Pong.$Shape;

            /**
             * Verifies a S2C_Pong message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Pong message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Pong
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Pong;

            /**
             * Creates a plain object from a S2C_Pong message. Also converts values to other types if specified.
             * @param message S2C_Pong
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Pong, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Pong to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Pong
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Pong {

            /** Properties of a S2C_Pong. */
            interface $Properties {

                /** S2C_Pong timestamp */
                timestamp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Pong. */
            type $Shape = jpt.base.S2C_Pong.$Properties;
        }

        /**
         * Properties of a S2C_Error.
         * @deprecated Use jpt.base.S2C_Error.$Properties instead.
         */
        interface IS2C_Error extends jpt.base.S2C_Error.$Properties {
        }

        /** Represents a S2C_Error. */
        class S2C_Error {

            /**
             * Constructs a new S2C_Error.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Error.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Error errorCode. */
            errorCode: jpt.base.ErrorCode;

            /** S2C_Error errorMessage. */
            errorMessage: string;

            /**
             * Creates a new S2C_Error instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Error instance
             */
            static create(properties: jpt.base.S2C_Error.$Shape): jpt.base.S2C_Error & jpt.base.S2C_Error.$Shape;
            static create(properties?: jpt.base.S2C_Error.$Properties): jpt.base.S2C_Error;

            /**
             * Encodes the specified S2C_Error message. Does not implicitly {@link jpt.base.S2C_Error.verify|verify} messages.
             * @param message S2C_Error message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Error.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Error message, length delimited. Does not implicitly {@link jpt.base.S2C_Error.verify|verify} messages.
             * @param message S2C_Error message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Error.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Error message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Error & jpt.base.S2C_Error.$Shape} S2C_Error
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Error & jpt.base.S2C_Error.$Shape;

            /**
             * Decodes a S2C_Error message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Error & jpt.base.S2C_Error.$Shape} S2C_Error
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Error & jpt.base.S2C_Error.$Shape;

            /**
             * Verifies a S2C_Error message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Error message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Error
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Error;

            /**
             * Creates a plain object from a S2C_Error message. Also converts values to other types if specified.
             * @param message S2C_Error
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Error, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Error to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Error
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Error {

            /** Properties of a S2C_Error. */
            interface $Properties {

                /** S2C_Error errorCode */
                errorCode?: (jpt.base.ErrorCode|null);

                /** S2C_Error errorMessage */
                errorMessage?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Error. */
            type $Shape = jpt.base.S2C_Error.$Properties;
        }

        /**
         * Properties of a S2C_SystemMessage.
         * @deprecated Use jpt.base.S2C_SystemMessage.$Properties instead.
         */
        interface IS2C_SystemMessage extends jpt.base.S2C_SystemMessage.$Properties {
        }

        /** Represents a S2C_SystemMessage. */
        class S2C_SystemMessage {

            /**
             * Constructs a new S2C_SystemMessage.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_SystemMessage.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_SystemMessage message. */
            message: string;

            /** S2C_SystemMessage timestamp. */
            timestamp: (number|Long);

            /**
             * Creates a new S2C_SystemMessage instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_SystemMessage instance
             */
            static create(properties: jpt.base.S2C_SystemMessage.$Shape): jpt.base.S2C_SystemMessage & jpt.base.S2C_SystemMessage.$Shape;
            static create(properties?: jpt.base.S2C_SystemMessage.$Properties): jpt.base.S2C_SystemMessage;

            /**
             * Encodes the specified S2C_SystemMessage message. Does not implicitly {@link jpt.base.S2C_SystemMessage.verify|verify} messages.
             * @param message S2C_SystemMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_SystemMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_SystemMessage message, length delimited. Does not implicitly {@link jpt.base.S2C_SystemMessage.verify|verify} messages.
             * @param message S2C_SystemMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_SystemMessage.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_SystemMessage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_SystemMessage & jpt.base.S2C_SystemMessage.$Shape} S2C_SystemMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_SystemMessage & jpt.base.S2C_SystemMessage.$Shape;

            /**
             * Decodes a S2C_SystemMessage message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_SystemMessage & jpt.base.S2C_SystemMessage.$Shape} S2C_SystemMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_SystemMessage & jpt.base.S2C_SystemMessage.$Shape;

            /**
             * Verifies a S2C_SystemMessage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_SystemMessage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_SystemMessage
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_SystemMessage;

            /**
             * Creates a plain object from a S2C_SystemMessage message. Also converts values to other types if specified.
             * @param message S2C_SystemMessage
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_SystemMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_SystemMessage to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_SystemMessage
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_SystemMessage {

            /** Properties of a S2C_SystemMessage. */
            interface $Properties {

                /** S2C_SystemMessage message */
                message?: (string|null);

                /** S2C_SystemMessage timestamp */
                timestamp?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_SystemMessage. */
            type $Shape = jpt.base.S2C_SystemMessage.$Properties;
        }

        /**
         * Properties of a S2C_Disconnect.
         * @deprecated Use jpt.base.S2C_Disconnect.$Properties instead.
         */
        interface IS2C_Disconnect extends jpt.base.S2C_Disconnect.$Properties {
        }

        /** Represents a S2C_Disconnect. */
        class S2C_Disconnect {

            /**
             * Constructs a new S2C_Disconnect.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.S2C_Disconnect.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** S2C_Disconnect reason. */
            reason: string;

            /**
             * Creates a new S2C_Disconnect instance using the specified properties.
             * @param [properties] Properties to set
             * @returns S2C_Disconnect instance
             */
            static create(properties: jpt.base.S2C_Disconnect.$Shape): jpt.base.S2C_Disconnect & jpt.base.S2C_Disconnect.$Shape;
            static create(properties?: jpt.base.S2C_Disconnect.$Properties): jpt.base.S2C_Disconnect;

            /**
             * Encodes the specified S2C_Disconnect message. Does not implicitly {@link jpt.base.S2C_Disconnect.verify|verify} messages.
             * @param message S2C_Disconnect message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.S2C_Disconnect.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified S2C_Disconnect message, length delimited. Does not implicitly {@link jpt.base.S2C_Disconnect.verify|verify} messages.
             * @param message S2C_Disconnect message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.S2C_Disconnect.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a S2C_Disconnect message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.S2C_Disconnect & jpt.base.S2C_Disconnect.$Shape} S2C_Disconnect
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.S2C_Disconnect & jpt.base.S2C_Disconnect.$Shape;

            /**
             * Decodes a S2C_Disconnect message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.S2C_Disconnect & jpt.base.S2C_Disconnect.$Shape} S2C_Disconnect
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.S2C_Disconnect & jpt.base.S2C_Disconnect.$Shape;

            /**
             * Verifies a S2C_Disconnect message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a S2C_Disconnect message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns S2C_Disconnect
             */
            static fromObject(object: { [k: string]: any }): jpt.base.S2C_Disconnect;

            /**
             * Creates a plain object from a S2C_Disconnect message. Also converts values to other types if specified.
             * @param message S2C_Disconnect
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.S2C_Disconnect, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this S2C_Disconnect to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for S2C_Disconnect
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace S2C_Disconnect {

            /** Properties of a S2C_Disconnect. */
            interface $Properties {

                /** S2C_Disconnect reason */
                reason?: (string|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a S2C_Disconnect. */
            type $Shape = jpt.base.S2C_Disconnect.$Properties;
        }

        /**
         * Properties of a Position.
         * @deprecated Use jpt.base.Position.$Properties instead.
         */
        interface IPosition extends jpt.base.Position.$Properties {
        }

        /** Represents a Position. */
        class Position {

            /**
             * Constructs a new Position.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.Position.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** Position x. */
            x: number;

            /** Position y. */
            y: number;

            /** Position z. */
            z: number;

            /**
             * Creates a new Position instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Position instance
             */
            static create(properties: jpt.base.Position.$Shape): jpt.base.Position & jpt.base.Position.$Shape;
            static create(properties?: jpt.base.Position.$Properties): jpt.base.Position;

            /**
             * Encodes the specified Position message. Does not implicitly {@link jpt.base.Position.verify|verify} messages.
             * @param message Position message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.Position.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Position message, length delimited. Does not implicitly {@link jpt.base.Position.verify|verify} messages.
             * @param message Position message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.Position.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Position message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.Position & jpt.base.Position.$Shape} Position
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.Position & jpt.base.Position.$Shape;

            /**
             * Decodes a Position message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.Position & jpt.base.Position.$Shape} Position
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.Position & jpt.base.Position.$Shape;

            /**
             * Verifies a Position message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Position message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Position
             */
            static fromObject(object: { [k: string]: any }): jpt.base.Position;

            /**
             * Creates a plain object from a Position message. Also converts values to other types if specified.
             * @param message Position
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.Position, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Position to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for Position
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace Position {

            /** Properties of a Position. */
            interface $Properties {

                /** Position x */
                x?: (number|null);

                /** Position y */
                y?: (number|null);

                /** Position z */
                z?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a Position. */
            type $Shape = jpt.base.Position.$Properties;
        }

        /**
         * Properties of a Vector3.
         * @deprecated Use jpt.base.Vector3.$Properties instead.
         */
        interface IVector3 extends jpt.base.Vector3.$Properties {
        }

        /** Represents a Vector3. */
        class Vector3 {

            /**
             * Constructs a new Vector3.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.Vector3.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** Vector3 x. */
            x: number;

            /** Vector3 y. */
            y: number;

            /** Vector3 z. */
            z: number;

            /**
             * Creates a new Vector3 instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Vector3 instance
             */
            static create(properties: jpt.base.Vector3.$Shape): jpt.base.Vector3 & jpt.base.Vector3.$Shape;
            static create(properties?: jpt.base.Vector3.$Properties): jpt.base.Vector3;

            /**
             * Encodes the specified Vector3 message. Does not implicitly {@link jpt.base.Vector3.verify|verify} messages.
             * @param message Vector3 message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.Vector3.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Vector3 message, length delimited. Does not implicitly {@link jpt.base.Vector3.verify|verify} messages.
             * @param message Vector3 message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.Vector3.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Vector3 message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.Vector3 & jpt.base.Vector3.$Shape} Vector3
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.Vector3 & jpt.base.Vector3.$Shape;

            /**
             * Decodes a Vector3 message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.Vector3 & jpt.base.Vector3.$Shape} Vector3
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.Vector3 & jpt.base.Vector3.$Shape;

            /**
             * Verifies a Vector3 message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Vector3 message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Vector3
             */
            static fromObject(object: { [k: string]: any }): jpt.base.Vector3;

            /**
             * Creates a plain object from a Vector3 message. Also converts values to other types if specified.
             * @param message Vector3
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.Vector3, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Vector3 to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for Vector3
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace Vector3 {

            /** Properties of a Vector3. */
            interface $Properties {

                /** Vector3 x */
                x?: (number|null);

                /** Vector3 y */
                y?: (number|null);

                /** Vector3 z */
                z?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a Vector3. */
            type $Shape = jpt.base.Vector3.$Properties;
        }

        /** ErrorCode enum. */
        enum ErrorCode {

            /** SUCCESS value */
            SUCCESS = 0,

            /** UNKNOWN_ERROR value */
            UNKNOWN_ERROR = 1,

            /** NOT_LOGIN value */
            NOT_LOGIN = 2,

            /** ALREADY_LOGIN value */
            ALREADY_LOGIN = 3,

            /** INVALID_PASSWORD value */
            INVALID_PASSWORD = 4,

            /** ACCOUNT_BANNED value */
            ACCOUNT_BANNED = 5,

            /** CHARACTER_NOT_FOUND value */
            CHARACTER_NOT_FOUND = 6,

            /** CHARACTER_LIMIT value */
            CHARACTER_LIMIT = 7,

            /** INVALID_MAP value */
            INVALID_MAP = 8,

            /** POSITION_INVALID value */
            POSITION_INVALID = 9,

            /** SPEED_HACK value */
            SPEED_HACK = 10,

            /** TELEPORT_HACK value */
            TELEPORT_HACK = 11,

            /** INVINCIBLE_HACK value */
            INVINCIBLE_HACK = 12,

            /** INVALID_NAME value */
            INVALID_NAME = 13,

            /** NAME_EXISTS value */
            NAME_EXISTS = 14
        }

        /** ItemType enum. */
        enum ItemType {

            /** WEAPON value */
            WEAPON = 0,

            /** ARMOR value */
            ARMOR = 1,

            /** ACCESSORY value */
            ACCESSORY = 2,

            /** CONSUMABLE value */
            CONSUMABLE = 3,

            /** MATERIAL value */
            MATERIAL = 4,

            /** QUEST value */
            QUEST = 5
        }

        /** MonsterState enum. */
        enum MonsterState {

            /** MONSTER_IDLE value */
            MONSTER_IDLE = 0,

            /** MONSTER_PATROL value */
            MONSTER_PATROL = 1,

            /** MONSTER_CHASE value */
            MONSTER_CHASE = 2,

            /** MONSTER_ATTACK value */
            MONSTER_ATTACK = 3,

            /** MONSTER_RETURN value */
            MONSTER_RETURN = 4,

            /** MONSTER_DEAD value */
            MONSTER_DEAD = 5
        }

        /** PlayerState enum. */
        enum PlayerState {

            /** PLAYER_ALIVE value */
            PLAYER_ALIVE = 0,

            /** PLAYER_DEAD value */
            PLAYER_DEAD = 1,

            /** PLAYER_SITTING value */
            PLAYER_SITTING = 2
        }

        /** ChatChannel enum. */
        enum ChatChannel {

            /** CHAT_WORLD value */
            CHAT_WORLD = 0,

            /** CHAT_MAP value */
            CHAT_MAP = 1,

            /** CHAT_PARTY value */
            CHAT_PARTY = 2,

            /** CHAT_GUILD value */
            CHAT_GUILD = 3,

            /** CHAT_PRIVATE value */
            CHAT_PRIVATE = 4,

            /** CHAT_SYSTEM value */
            CHAT_SYSTEM = 5
        }

        /** SkillType enum. */
        enum SkillType {

            /** SKILL_PHYSICAL_ATTACK value */
            SKILL_PHYSICAL_ATTACK = 0,

            /** SKILL_MAGIC_ATTACK value */
            SKILL_MAGIC_ATTACK = 1,

            /** SKILL_HEAL value */
            SKILL_HEAL = 2,

            /** SKILL_BUFF value */
            SKILL_BUFF = 3,

            /** SKILL_AOE value */
            SKILL_AOE = 4
        }

        /** EquipmentSlotType enum. */
        enum EquipmentSlotType {

            /** EQUIP_WEAPON value */
            EQUIP_WEAPON = 0,

            /** EQUIP_HEAD value */
            EQUIP_HEAD = 1,

            /** EQUIP_BODY value */
            EQUIP_BODY = 2,

            /** EQUIP_LEGS value */
            EQUIP_LEGS = 3,

            /** EQUIP_FEET value */
            EQUIP_FEET = 4,

            /** EQUIP_HANDS value */
            EQUIP_HANDS = 5,

            /** EQUIP_ACCESSORY value */
            EQUIP_ACCESSORY = 6,

            /** EQUIP_RING value */
            EQUIP_RING = 7,

            /** EQUIP_NECKLACE value */
            EQUIP_NECKLACE = 8
        }

        /**
         * Properties of an ItemProto.
         * @deprecated Use jpt.base.ItemProto.$Properties instead.
         */
        interface IItemProto extends jpt.base.ItemProto.$Properties {
        }

        /** Represents an ItemProto. */
        class ItemProto {

            /**
             * Constructs a new ItemProto.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.ItemProto.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** ItemProto itemId. */
            itemId: number;

            /** ItemProto quantity. */
            quantity: number;

            /** ItemProto stackable. */
            stackable: boolean;

            /** ItemProto maxStack. */
            maxStack: number;

            /**
             * Creates a new ItemProto instance using the specified properties.
             * @param [properties] Properties to set
             * @returns ItemProto instance
             */
            static create(properties: jpt.base.ItemProto.$Shape): jpt.base.ItemProto & jpt.base.ItemProto.$Shape;
            static create(properties?: jpt.base.ItemProto.$Properties): jpt.base.ItemProto;

            /**
             * Encodes the specified ItemProto message. Does not implicitly {@link jpt.base.ItemProto.verify|verify} messages.
             * @param message ItemProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.ItemProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified ItemProto message, length delimited. Does not implicitly {@link jpt.base.ItemProto.verify|verify} messages.
             * @param message ItemProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.ItemProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an ItemProto message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.ItemProto & jpt.base.ItemProto.$Shape} ItemProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.ItemProto & jpt.base.ItemProto.$Shape;

            /**
             * Decodes an ItemProto message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.ItemProto & jpt.base.ItemProto.$Shape} ItemProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.ItemProto & jpt.base.ItemProto.$Shape;

            /**
             * Verifies an ItemProto message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an ItemProto message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ItemProto
             */
            static fromObject(object: { [k: string]: any }): jpt.base.ItemProto;

            /**
             * Creates a plain object from an ItemProto message. Also converts values to other types if specified.
             * @param message ItemProto
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.ItemProto, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ItemProto to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for ItemProto
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace ItemProto {

            /** Properties of an ItemProto. */
            interface $Properties {

                /** ItemProto itemId */
                itemId?: (number|null);

                /** ItemProto quantity */
                quantity?: (number|null);

                /** ItemProto stackable */
                stackable?: (boolean|null);

                /** ItemProto maxStack */
                maxStack?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of an ItemProto. */
            type $Shape = jpt.base.ItemProto.$Properties;
        }

        /**
         * Properties of a GroundItemProto.
         * @deprecated Use jpt.base.GroundItemProto.$Properties instead.
         */
        interface IGroundItemProto extends jpt.base.GroundItemProto.$Properties {
        }

        /** Represents a GroundItemProto. */
        class GroundItemProto {

            /**
             * Constructs a new GroundItemProto.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.GroundItemProto.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** GroundItemProto groundItemId. */
            groundItemId: (number|Long);

            /** GroundItemProto itemId. */
            itemId: number;

            /** GroundItemProto quantity. */
            quantity: number;

            /** GroundItemProto position. */
            position?: (jpt.base.Position.$Properties|null);

            /** GroundItemProto ownerId. */
            ownerId: (number|Long);

            /** GroundItemProto expireTime. */
            expireTime: (number|Long);

            /**
             * Creates a new GroundItemProto instance using the specified properties.
             * @param [properties] Properties to set
             * @returns GroundItemProto instance
             */
            static create(properties: jpt.base.GroundItemProto.$Shape): jpt.base.GroundItemProto & jpt.base.GroundItemProto.$Shape;
            static create(properties?: jpt.base.GroundItemProto.$Properties): jpt.base.GroundItemProto;

            /**
             * Encodes the specified GroundItemProto message. Does not implicitly {@link jpt.base.GroundItemProto.verify|verify} messages.
             * @param message GroundItemProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.GroundItemProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified GroundItemProto message, length delimited. Does not implicitly {@link jpt.base.GroundItemProto.verify|verify} messages.
             * @param message GroundItemProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.GroundItemProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a GroundItemProto message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.GroundItemProto & jpt.base.GroundItemProto.$Shape} GroundItemProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.GroundItemProto & jpt.base.GroundItemProto.$Shape;

            /**
             * Decodes a GroundItemProto message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.GroundItemProto & jpt.base.GroundItemProto.$Shape} GroundItemProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.GroundItemProto & jpt.base.GroundItemProto.$Shape;

            /**
             * Verifies a GroundItemProto message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a GroundItemProto message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns GroundItemProto
             */
            static fromObject(object: { [k: string]: any }): jpt.base.GroundItemProto;

            /**
             * Creates a plain object from a GroundItemProto message. Also converts values to other types if specified.
             * @param message GroundItemProto
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.GroundItemProto, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this GroundItemProto to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for GroundItemProto
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace GroundItemProto {

            /** Properties of a GroundItemProto. */
            interface $Properties {

                /** GroundItemProto groundItemId */
                groundItemId?: (number|Long|null);

                /** GroundItemProto itemId */
                itemId?: (number|null);

                /** GroundItemProto quantity */
                quantity?: (number|null);

                /** GroundItemProto position */
                position?: (jpt.base.Position.$Properties|null);

                /** GroundItemProto ownerId */
                ownerId?: (number|Long|null);

                /** GroundItemProto expireTime */
                expireTime?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a GroundItemProto. */
            type $Shape = jpt.base.GroundItemProto.$Properties;
        }

        /**
         * Properties of a BuffEffectProto.
         * @deprecated Use jpt.base.BuffEffectProto.$Properties instead.
         */
        interface IBuffEffectProto extends jpt.base.BuffEffectProto.$Properties {
        }

        /** Represents a BuffEffectProto. */
        class BuffEffectProto {

            /**
             * Constructs a new BuffEffectProto.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.BuffEffectProto.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** BuffEffectProto type. */
            type: string;

            /** BuffEffectProto value. */
            value: number;

            /**
             * Creates a new BuffEffectProto instance using the specified properties.
             * @param [properties] Properties to set
             * @returns BuffEffectProto instance
             */
            static create(properties: jpt.base.BuffEffectProto.$Shape): jpt.base.BuffEffectProto & jpt.base.BuffEffectProto.$Shape;
            static create(properties?: jpt.base.BuffEffectProto.$Properties): jpt.base.BuffEffectProto;

            /**
             * Encodes the specified BuffEffectProto message. Does not implicitly {@link jpt.base.BuffEffectProto.verify|verify} messages.
             * @param message BuffEffectProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.BuffEffectProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified BuffEffectProto message, length delimited. Does not implicitly {@link jpt.base.BuffEffectProto.verify|verify} messages.
             * @param message BuffEffectProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.BuffEffectProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a BuffEffectProto message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.BuffEffectProto & jpt.base.BuffEffectProto.$Shape} BuffEffectProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.BuffEffectProto & jpt.base.BuffEffectProto.$Shape;

            /**
             * Decodes a BuffEffectProto message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.BuffEffectProto & jpt.base.BuffEffectProto.$Shape} BuffEffectProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.BuffEffectProto & jpt.base.BuffEffectProto.$Shape;

            /**
             * Verifies a BuffEffectProto message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a BuffEffectProto message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns BuffEffectProto
             */
            static fromObject(object: { [k: string]: any }): jpt.base.BuffEffectProto;

            /**
             * Creates a plain object from a BuffEffectProto message. Also converts values to other types if specified.
             * @param message BuffEffectProto
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.BuffEffectProto, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this BuffEffectProto to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for BuffEffectProto
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace BuffEffectProto {

            /** Properties of a BuffEffectProto. */
            interface $Properties {

                /** BuffEffectProto type */
                type?: (string|null);

                /** BuffEffectProto value */
                value?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a BuffEffectProto. */
            type $Shape = jpt.base.BuffEffectProto.$Properties;
        }

        /**
         * Properties of a BuffProto.
         * @deprecated Use jpt.base.BuffProto.$Properties instead.
         */
        interface IBuffProto extends jpt.base.BuffProto.$Properties {
        }

        /** Represents a BuffProto. */
        class BuffProto {

            /**
             * Constructs a new BuffProto.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.BuffProto.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** BuffProto buffId. */
            buffId: (number|Long);

            /** BuffProto skillId. */
            skillId: number;

            /** BuffProto casterId. */
            casterId: (number|Long);

            /** BuffProto duration. */
            duration: number;

            /** BuffProto effects. */
            effects: jpt.base.BuffEffectProto.$Properties[];

            /** BuffProto applyTime. */
            applyTime: (number|Long);

            /**
             * Creates a new BuffProto instance using the specified properties.
             * @param [properties] Properties to set
             * @returns BuffProto instance
             */
            static create(properties: jpt.base.BuffProto.$Shape): jpt.base.BuffProto & jpt.base.BuffProto.$Shape;
            static create(properties?: jpt.base.BuffProto.$Properties): jpt.base.BuffProto;

            /**
             * Encodes the specified BuffProto message. Does not implicitly {@link jpt.base.BuffProto.verify|verify} messages.
             * @param message BuffProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.BuffProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified BuffProto message, length delimited. Does not implicitly {@link jpt.base.BuffProto.verify|verify} messages.
             * @param message BuffProto message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.BuffProto.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a BuffProto message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.BuffProto & jpt.base.BuffProto.$Shape} BuffProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.BuffProto & jpt.base.BuffProto.$Shape;

            /**
             * Decodes a BuffProto message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.BuffProto & jpt.base.BuffProto.$Shape} BuffProto
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.BuffProto & jpt.base.BuffProto.$Shape;

            /**
             * Verifies a BuffProto message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a BuffProto message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns BuffProto
             */
            static fromObject(object: { [k: string]: any }): jpt.base.BuffProto;

            /**
             * Creates a plain object from a BuffProto message. Also converts values to other types if specified.
             * @param message BuffProto
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.BuffProto, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this BuffProto to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for BuffProto
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace BuffProto {

            /** Properties of a BuffProto. */
            interface $Properties {

                /** BuffProto buffId */
                buffId?: (number|Long|null);

                /** BuffProto skillId */
                skillId?: (number|null);

                /** BuffProto casterId */
                casterId?: (number|Long|null);

                /** BuffProto duration */
                duration?: (number|null);

                /** BuffProto effects */
                effects?: (jpt.base.BuffEffectProto.$Properties[]|null);

                /** BuffProto applyTime */
                applyTime?: (number|Long|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a BuffProto. */
            type $Shape = jpt.base.BuffProto.$Properties;
        }

        /**
         * Properties of a Rotation.
         * @deprecated Use jpt.base.Rotation.$Properties instead.
         */
        interface IRotation extends jpt.base.Rotation.$Properties {
        }

        /** Represents a Rotation. */
        class Rotation {

            /**
             * Constructs a new Rotation.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.Rotation.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** Rotation x. */
            x: number;

            /** Rotation y. */
            y: number;

            /** Rotation z. */
            z: number;

            /**
             * Creates a new Rotation instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Rotation instance
             */
            static create(properties: jpt.base.Rotation.$Shape): jpt.base.Rotation & jpt.base.Rotation.$Shape;
            static create(properties?: jpt.base.Rotation.$Properties): jpt.base.Rotation;

            /**
             * Encodes the specified Rotation message. Does not implicitly {@link jpt.base.Rotation.verify|verify} messages.
             * @param message Rotation message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.Rotation.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Rotation message, length delimited. Does not implicitly {@link jpt.base.Rotation.verify|verify} messages.
             * @param message Rotation message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.Rotation.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Rotation message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.Rotation & jpt.base.Rotation.$Shape} Rotation
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.Rotation & jpt.base.Rotation.$Shape;

            /**
             * Decodes a Rotation message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.Rotation & jpt.base.Rotation.$Shape} Rotation
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.Rotation & jpt.base.Rotation.$Shape;

            /**
             * Verifies a Rotation message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Rotation message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Rotation
             */
            static fromObject(object: { [k: string]: any }): jpt.base.Rotation;

            /**
             * Creates a plain object from a Rotation message. Also converts values to other types if specified.
             * @param message Rotation
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.Rotation, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Rotation to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for Rotation
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace Rotation {

            /** Properties of a Rotation. */
            interface $Properties {

                /** Rotation x */
                x?: (number|null);

                /** Rotation y */
                y?: (number|null);

                /** Rotation z */
                z?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a Rotation. */
            type $Shape = jpt.base.Rotation.$Properties;
        }

        /**
         * Properties of a CharacterAppearance.
         * @deprecated Use jpt.base.CharacterAppearance.$Properties instead.
         */
        interface ICharacterAppearance extends jpt.base.CharacterAppearance.$Properties {
        }

        /** Represents a CharacterAppearance. */
        class CharacterAppearance {

            /**
             * Constructs a new CharacterAppearance.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.CharacterAppearance.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** CharacterAppearance classId. */
            classId: number;

            /** CharacterAppearance head. */
            head: number;

            /** CharacterAppearance rank. */
            rank: number;

            /** CharacterAppearance bodyModel. */
            bodyModel: string;

            /** CharacterAppearance bodyModelIdcode. */
            bodyModelIdcode: number;

            /** CharacterAppearance weaponDorp. */
            weaponDorp: string;

            /** CharacterAppearance weaponIdcode. */
            weaponIdcode: number;

            /** CharacterAppearance weaponPos. */
            weaponPos: number;

            /** CharacterAppearance sizeLevel. */
            sizeLevel: number;

            /**
             * Creates a new CharacterAppearance instance using the specified properties.
             * @param [properties] Properties to set
             * @returns CharacterAppearance instance
             */
            static create(properties: jpt.base.CharacterAppearance.$Shape): jpt.base.CharacterAppearance & jpt.base.CharacterAppearance.$Shape;
            static create(properties?: jpt.base.CharacterAppearance.$Properties): jpt.base.CharacterAppearance;

            /**
             * Encodes the specified CharacterAppearance message. Does not implicitly {@link jpt.base.CharacterAppearance.verify|verify} messages.
             * @param message CharacterAppearance message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.CharacterAppearance.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified CharacterAppearance message, length delimited. Does not implicitly {@link jpt.base.CharacterAppearance.verify|verify} messages.
             * @param message CharacterAppearance message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.CharacterAppearance.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a CharacterAppearance message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.CharacterAppearance & jpt.base.CharacterAppearance.$Shape} CharacterAppearance
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.CharacterAppearance & jpt.base.CharacterAppearance.$Shape;

            /**
             * Decodes a CharacterAppearance message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.CharacterAppearance & jpt.base.CharacterAppearance.$Shape} CharacterAppearance
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.CharacterAppearance & jpt.base.CharacterAppearance.$Shape;

            /**
             * Verifies a CharacterAppearance message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a CharacterAppearance message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns CharacterAppearance
             */
            static fromObject(object: { [k: string]: any }): jpt.base.CharacterAppearance;

            /**
             * Creates a plain object from a CharacterAppearance message. Also converts values to other types if specified.
             * @param message CharacterAppearance
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.CharacterAppearance, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this CharacterAppearance to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for CharacterAppearance
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace CharacterAppearance {

            /** Properties of a CharacterAppearance. */
            interface $Properties {

                /** CharacterAppearance classId */
                classId?: (number|null);

                /** CharacterAppearance head */
                head?: (number|null);

                /** CharacterAppearance rank */
                rank?: (number|null);

                /** CharacterAppearance bodyModel */
                bodyModel?: (string|null);

                /** CharacterAppearance bodyModelIdcode */
                bodyModelIdcode?: (number|null);

                /** CharacterAppearance weaponDorp */
                weaponDorp?: (string|null);

                /** CharacterAppearance weaponIdcode */
                weaponIdcode?: (number|null);

                /** CharacterAppearance weaponPos */
                weaponPos?: (number|null);

                /** CharacterAppearance sizeLevel */
                sizeLevel?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a CharacterAppearance. */
            type $Shape = jpt.base.CharacterAppearance.$Properties;
        }

        /**
         * Properties of a PlayerAppearInfo.
         * @deprecated Use jpt.base.PlayerAppearInfo.$Properties instead.
         */
        interface IPlayerAppearInfo extends jpt.base.PlayerAppearInfo.$Properties {
        }

        /** Represents a PlayerAppearInfo. */
        class PlayerAppearInfo {

            /**
             * Constructs a new PlayerAppearInfo.
             * @param [properties] Properties to set
             */
            constructor(properties?: jpt.base.PlayerAppearInfo.$Properties);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];

            /** PlayerAppearInfo playerId. */
            playerId: (number|Long);

            /** PlayerAppearInfo name. */
            name: string;

            /** PlayerAppearInfo level. */
            level: number;

            /** PlayerAppearInfo appearance. */
            appearance?: (jpt.base.CharacterAppearance.$Properties|null);

            /** PlayerAppearInfo position. */
            position?: (jpt.base.Position.$Properties|null);

            /** PlayerAppearInfo rotation. */
            rotation?: (jpt.base.Rotation.$Properties|null);

            /** PlayerAppearInfo state. */
            state: number;

            /** PlayerAppearInfo hp. */
            hp: number;

            /** PlayerAppearInfo maxHp. */
            maxHp: number;

            /**
             * Creates a new PlayerAppearInfo instance using the specified properties.
             * @param [properties] Properties to set
             * @returns PlayerAppearInfo instance
             */
            static create(properties: jpt.base.PlayerAppearInfo.$Shape): jpt.base.PlayerAppearInfo & jpt.base.PlayerAppearInfo.$Shape;
            static create(properties?: jpt.base.PlayerAppearInfo.$Properties): jpt.base.PlayerAppearInfo;

            /**
             * Encodes the specified PlayerAppearInfo message. Does not implicitly {@link jpt.base.PlayerAppearInfo.verify|verify} messages.
             * @param message PlayerAppearInfo message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encode(message: jpt.base.PlayerAppearInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified PlayerAppearInfo message, length delimited. Does not implicitly {@link jpt.base.PlayerAppearInfo.verify|verify} messages.
             * @param message PlayerAppearInfo message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            static encodeDelimited(message: jpt.base.PlayerAppearInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a PlayerAppearInfo message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns {jpt.base.PlayerAppearInfo & jpt.base.PlayerAppearInfo.$Shape} PlayerAppearInfo
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): jpt.base.PlayerAppearInfo & jpt.base.PlayerAppearInfo.$Shape;

            /**
             * Decodes a PlayerAppearInfo message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns {jpt.base.PlayerAppearInfo & jpt.base.PlayerAppearInfo.$Shape} PlayerAppearInfo
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): jpt.base.PlayerAppearInfo & jpt.base.PlayerAppearInfo.$Shape;

            /**
             * Verifies a PlayerAppearInfo message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a PlayerAppearInfo message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns PlayerAppearInfo
             */
            static fromObject(object: { [k: string]: any }): jpt.base.PlayerAppearInfo;

            /**
             * Creates a plain object from a PlayerAppearInfo message. Also converts values to other types if specified.
             * @param message PlayerAppearInfo
             * @param [options] Conversion options
             * @returns Plain object
             */
            static toObject(message: jpt.base.PlayerAppearInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this PlayerAppearInfo to JSON.
             * @returns JSON object
             */
            toJSON(): { [k: string]: any };

            /**
             * Gets the type url for PlayerAppearInfo
             * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
             * @returns The type url
             */
            static getTypeUrl(prefix?: string): string;
        }

        namespace PlayerAppearInfo {

            /** Properties of a PlayerAppearInfo. */
            interface $Properties {

                /** PlayerAppearInfo playerId */
                playerId?: (number|Long|null);

                /** PlayerAppearInfo name */
                name?: (string|null);

                /** PlayerAppearInfo level */
                level?: (number|null);

                /** PlayerAppearInfo appearance */
                appearance?: (jpt.base.CharacterAppearance.$Properties|null);

                /** PlayerAppearInfo position */
                position?: (jpt.base.Position.$Properties|null);

                /** PlayerAppearInfo rotation */
                rotation?: (jpt.base.Rotation.$Properties|null);

                /** PlayerAppearInfo state */
                state?: (number|null);

                /** PlayerAppearInfo hp */
                hp?: (number|null);

                /** PlayerAppearInfo maxHp */
                maxHp?: (number|null);

                /** Unknown fields preserved while decoding when enabled */
                $unknowns?: Uint8Array[];
            }

            /** Shape of a PlayerAppearInfo. */
            type $Shape = jpt.base.PlayerAppearInfo.$Properties;
        }
    }
}
