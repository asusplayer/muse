import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import Command from '../commands/index.js';

interface RegisterCommandsOnGuildOptions {
  rest: REST;
  applicationId: string;
  guildId: string;
  commands: Command[];
}

export const getCommandBodies = (commands: Command[]) => commands.flatMap(command => (
  command.contextMenuCommand ? [command.slashCommand.toJSON(), command.contextMenuCommand.toJSON()] : [command.slashCommand.toJSON()]
));

const registerCommandsOnGuild = async ({rest, applicationId, guildId, commands}: RegisterCommandsOnGuildOptions) => {
  await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    {body: getCommandBodies(commands)},
  );
};

export default registerCommandsOnGuild;
