import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { initializeAgentExecutorWithOptions, AgentExecutor } from 'langchain/agents'
import { getBaseClasses, mapChatHistory, handleEscapeCharacters } from '../../../src/utils'
import { BaseLanguageModel } from 'langchain/base_language'
import { formatResponse } from '../../outputparsers/OutputParserHelpers'
import { flatten } from 'lodash'
import { BaseChatMemory } from 'langchain/memory'
import { ConsoleCallbackHandler, CustomChainHandler, additionalCallbacks } from '../../../src/handler'

class OpenAIFunctionAgent_Agents implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'OpenAI Function Agent'
        this.name = 'openAIFunctionAgent'
        this.version = 3.0
        this.type = 'AgentExecutor'
        this.category = 'Agents'
        this.icon = 'function.svg'
        this.description = `An agent that uses Function Calling to pick the tool and args to call`
        this.baseClasses = [this.type, ...getBaseClasses(AgentExecutor)]
        this.inputs = [
            {
                label: 'Allowed Tools',
                name: 'tools',
                type: 'Tool',
                list: true
            },
            {
                label: 'Prompt',
                name: 'prompt',
                type: 'BasePromptTemplate'
            },
            {
                label: 'Memory',
                name: 'memory',
                type: 'BaseChatMemory'
            },
            {
                label: 'OpenAI/Azure Chat Model',
                name: 'model',
                type: 'BaseChatModel'
            },
            {
                label: 'System Message',
                name: 'systemMessage',
                type: 'string',
                rows: 4,
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const model = nodeData.inputs?.model as BaseLanguageModel
        const memory = nodeData.inputs?.memory as BaseChatMemory
        // const systemMessage = nodeData.inputs?.systemMessage as string
        const prompt = nodeData.inputs?.prompt
        console.log('OpenAIFunctionAgent: prompt:', prompt)
        console.log('OpenAIFunctionAgent: systemMessagePrompt:', `\n${prompt.systemMessagePrompt}\n${prompt.humanMessagePrompt}`)

        const agentPrompt = `\n${prompt.systemMessagePrompt}\n${prompt.humanMessagePrompt}`

        let tools = nodeData.inputs?.tools
        tools = flatten(tools)

        const executor = await initializeAgentExecutorWithOptions(tools, model, {
            agentType: 'openai-functions',
            verbose: process.env.DEBUG === 'true' ? true : false,
            agentArgs: {
                prefix: agentPrompt ?? `You are a helpful AI assistant.`
            }
        })
        if (memory) executor.memory = memory

        return executor
    }
    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string | object> {
        console.log('OpenAIFunctionAgent: Debug: nodeData instance', nodeData.instance)
        console.log('OpenAIFunctionAgent: Debug: nodeData inputs', nodeData.inputs)
        const executor = nodeData.instance as AgentExecutor
        const memory = nodeData.inputs?.memory as BaseChatMemory

        if (options && options.chatHistory) {
            const chatHistoryClassName = memory.chatHistory.constructor.name
            // Only replace when its In-Memory
            if (chatHistoryClassName && chatHistoryClassName === 'ChatMessageHistory') {
                memory.chatHistory = mapChatHistory(options)
                executor.memory = memory
            }
        }

        ;(executor.memory as any).returnMessages = true // Return true for BaseChatModel
        console.log('OpenAIFunctionAgent: Chuẩn bị check inputvariables + promptvalues')
        const inputVariables = nodeData.inputs?.prompt?.prompt?.inputVariables as string[] // ["product"]
        // const inputVariables = nodeData.instance.prompt.inputVariables as string[] // ["product"]
        const promptValues: ICommonObject | undefined = nodeData.inputs?.prompt?.prompt?.promptValues as ICommonObject
        console.log('OpenAIFunctionAgent: inputVariables: ', inputVariables)
        console.log('OpenAIFunctionAgent: promptValues: ', promptValues)
        const res = await runPrediction(executor, input, options, nodeData, inputVariables, promptValues)

        // eslint-disable-next-line no-console
        console.log('\x1b[93m\x1b[1m\n*****FINAL RESULT*****\n\x1b[0m\x1b[0m')
        // eslint-disable-next-line no-console
        console.log(res)
        return res
    }
}
const runPrediction = async (
    executor: AgentExecutor,
    input: string,
    options: ICommonObject,
    nodeData: INodeData,
    inputVariables: string[],
    promptValuesRaw: ICommonObject | undefined
) => {
    const loggerHandler = new ConsoleCallbackHandler(options.logger)
    const callbacks = await additionalCallbacks(nodeData, options)
    const isStreaming = options.socketIO && options.socketIOClientId
    const socketIO = isStreaming ? options.socketIO : undefined
    const socketIOClientId = isStreaming ? options.socketIOClientId : ''
    const promptValues = handleEscapeCharacters(promptValuesRaw, true)
    // console.log('inputVariables: ', inputVariables)
    console.log('OpenAIFunctionAgent: promptValues of runPrediction: ', promptValues)
    console.log('OpenAIFunctionAgent: promptValuesRaw of runPrediction: ', promptValuesRaw)

    // Logic to handle inputVariables and promptValues
    if (promptValues && inputVariables.length > 0) {
        let seen: string[] = []

        for (const variable of inputVariables) {
            seen.push(variable)
            if (promptValues[variable]) {
                seen.pop()
            }
        }

        if (seen.length === 0) {
            // All inputVariables have fixed values specified
            const options = { ...promptValues }
            if (isStreaming) {
                const handler = new CustomChainHandler(socketIO, socketIOClientId)
                const res = await executor.call(options, [loggerHandler, handler, ...callbacks])
                // return formatResponse(res?.text)
                return res
            } else {
                const res = await executor.call(options, [loggerHandler, ...callbacks])
                // return formatResponse(res?.text)
                return res
            }
        } else if (seen.length === 1) {
            // If one inputVariable is not specify, use input (user's question) as value
            const lastValue = seen.pop()
            if (!lastValue) throw new Error('Please provide Prompt Values')
            const options = {
                ...promptValues,
                [lastValue]: input
            }
            if (isStreaming) {
                const handler = new CustomChainHandler(socketIO, socketIOClientId)
                const res = await executor.call(options, [loggerHandler, handler, ...callbacks])
                console.log('Res: ', res)
                return formatResponse(res?.text)
            } else {
                const res = await executor.call(options, [loggerHandler, ...callbacks])
                console.log('Res: ', res)
                return formatResponse(res?.text)
            }
        } else {
            throw new Error(`Please provide Prompt Values for: ${seen.join(', ')}`)
        }
    } else {
        if (options.socketIO && options.socketIOClientId) {
            const handler = new CustomChainHandler(options.socketIO, options.socketIOClientId)
            const result = await executor.run(input, [loggerHandler, handler, ...callbacks])
            return result
        } else {
            const result = await executor.run(input, [loggerHandler, ...callbacks])
            return result
        }
    }
}

module.exports = { nodeClass: OpenAIFunctionAgent_Agents }
