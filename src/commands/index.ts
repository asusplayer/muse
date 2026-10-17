import {SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder} from '@discordjs/builders';
import {AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, StringSelectMenuInteraction} from 'discord.js';

export default interface Command {
  readonly slashCommand: Partial<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;
  readonly contextMenuCommand?: ContextMenuCommandBuilder;
  readonly handledButtonIds?: readonly string[];
  readonly handledSelectMenuIds?: readonly string[];
  readonly requiresVC?: boolean | ((interaction: ChatInputCommandInteraction) => boolean);
  readonly requiresDJ?: boolean | ((interaction: ChatInputCommandInteraction) => boolean);
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  handleButtonInteraction?: (interaction: ButtonInteraction) => Promise<void>;
  handleAutocompleteInteraction?: (interaction: AutocompleteInteraction) => Promise<void>;
  handleMessageContextMenu?: (interaction: MessageContextMenuCommandInteraction) => Promise<void>;
  handleSelectMenuInteraction?: (interaction: StringSelectMenuInteraction) => Promise<void>;
}
