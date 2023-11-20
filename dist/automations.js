const yaml_1 = require("../util/yaml");
const data_1 = require("../util/data");
const buffer_1 = require("buffer");
function toArray(item) {
    return Array.isArray(item) ? item : [item];
}
var ConfigSunCalc;
(function (ConfigSunCalc) {
    ConfigSunCalc["SOLAR_NOON"] = "solarNoon";
    ConfigSunCalc["NADIR"] = "nadir";
    ConfigSunCalc["SUNRISE"] = "sunrise";
    ConfigSunCalc["SUNSET"] = "sunset";
    ConfigSunCalc["SUNRISE_END"] = "sunriseEnd";
    ConfigSunCalc["SUNSET_START"] = "sunsetStart";
    ConfigSunCalc["DAWN"] = "dawn";
    ConfigSunCalc["DUSK"] = "dusk";
    ConfigSunCalc["NAUTICAL_DAWN"] = "nauticalDawn";
    ConfigSunCalc["NAUTICAL_DUSK"] = "nauticalDusk";
    ConfigSunCalc["NIGHT_END"] = "nightEnd";
    ConfigSunCalc["NIGHT"] = "night";
    ConfigSunCalc["GOLDEN_HOUR_END"] = "goldenHourEnd";
    ConfigSunCalc["GOLDEN_HOUR"] = "goldenHour";
})(ConfigSunCalc || (ConfigSunCalc = {}));
var ConfigState;
(function (ConfigState) {
    ConfigState["ON"] = "ON";
    ConfigState["OFF"] = "OFF";
    ConfigState["TOGGLE"] = "TOGGLE";
})(ConfigState || (ConfigState = {}));
var ConfigPayload;
(function (ConfigPayload) {
    ConfigPayload["TOGGLE"] = "toggle";
    ConfigPayload["TURN_ON"] = "turn_on";
    ConfigPayload["TURN_OFF"] = "turn_off";
})(ConfigPayload || (ConfigPayload = {}));
class InternalLogger {
    constructor() { }
    debug(message, ...args) {
        console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;247m${message}\x1b[0m`, ...args);
    }
    warning(message, ...args) {
        console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;220m${message}\x1b[0m`, ...args);
    }
    info(message, ...args) {
        console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;255m${message}\x1b[0m`, ...args);
    }
    error(message, ...args) {
        console.log(`\x1b[46m\x1b[97m[Automations]\x1b[0m \x1b[38;5;9m${message}\x1b[0m`, ...args);
    }
}
class AutomationsExtension {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.settings = settings;
        this.logger = logger;
        this.eventAutomations = {};
        this.timeAutomations = {};
        this.log = new InternalLogger();
        this.mqttBaseTopic = settings.get().mqtt.base_topic;
        this.triggerForTimeouts = {};
        this.turnOffAfterTimeouts = {};
        this.parseConfig(settings.get().automations || {});
        this.logger.info(`[Automations] Extension loaded`);
        Object.keys(this.timeAutomations).forEach(key => {
            const timeAutomationArray = this.timeAutomations[key];
            timeAutomationArray.forEach(timeAutomation => {
                this.startTimeTriggers(key, timeAutomation);
            });
        });
        this.startMidnightTimeout();
    }
    parseConfig(configAutomations) {
        if (typeof configAutomations === 'string') {
            configAutomations = (yaml_1.default.readIfExists(data_1.default.joinPath(configAutomations)) || {});
        }
        Object.entries(configAutomations).forEach(([key, configAutomation]) => {
            const actions = toArray(configAutomation.action);
            const conditions = configAutomation.condition ? toArray(configAutomation.condition) : [];
            const triggers = toArray(configAutomation.trigger);
            if (configAutomation.active === false) {
                this.logger.info(`[Automations] Automation [${key}] not registered since active is false`);
                return;
            }
            if (!configAutomation.trigger) {
                this.logger.error(`[Automations] Config validation error for [${key}]: no triggers defined`);
                return;
            }
            if (!configAutomation.action) {
                this.logger.error(`[Automations] Config validation error for [${key}]: no actions defined`);
                return;
            }
            for (const trigger of triggers) {
                if (!trigger.time && !trigger.entity) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity not defined`);
                    return;
                }
                if (!trigger.time && !this.zigbee.resolveEntity(trigger.entity)) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity #${trigger.entity}# not found`);
                    return;
                }
            }
            for (const action of actions) {
                if (!action.entity) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: action entity not defined`);
                    return;
                }
                if (!this.zigbee.resolveEntity(action.entity)) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: action entity #${action.entity}# not found`);
                    return;
                }
                if (!action.payload) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: action payload not defined`);
                    return;
                }
            }
            for (const condition of conditions) {
                if (!condition.entity && !condition.after && !condition.before && !condition.weekday) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: condition unknown`);
                    return;
                }
                if (condition.entity && !this.zigbee.resolveEntity(condition.entity)) {
                    this.logger.error(`[Automations] Config validation error for [${key}]: condition entity #${condition.entity}# not found`);
                    return;
                }
            }
            for (const trigger of triggers) {
                if (trigger.time !== undefined) {
                    const timeTrigger = trigger;
                    this.logger.info(`[Automations] Registering time automation [${key}] trigger: ${timeTrigger.time}`);
                    const suncalcs = Object.values(ConfigSunCalc);
                    if (suncalcs.includes(timeTrigger.time)) {
                        if (!timeTrigger.latitude || !timeTrigger.longitude) {
                            this.logger.error(`[Automations] Config validation error for [${key}]: latitude and longitude are mandatory for ${trigger.time}`);
                            return;
                        }
                        const suncalc = new SunCalc();
                        const times = suncalc.getTimes(new Date(), timeTrigger.latitude, timeTrigger.longitude, timeTrigger.elevation ? timeTrigger.elevation : 0);
                        this.logger.debug(`[Automations] Sunrise at ${times[ConfigSunCalc.SUNRISE].toLocaleTimeString()} sunset at ${times[ConfigSunCalc.SUNSET].toLocaleTimeString()} for latitude:${timeTrigger.latitude} longitude:${timeTrigger.longitude} elevation:${timeTrigger.elevation ? timeTrigger.elevation : 0}`);
                        this.log.debug(`[Automations] For latitude:${timeTrigger.latitude} longitude:${timeTrigger.longitude} elevation:${timeTrigger.elevation ? timeTrigger.elevation : 0} suncalc are:\n`, times);
                        const time = times[trigger.time].toLocaleTimeString();
                        if (!this.timeAutomations[time])
                            this.timeAutomations[time] = [];
                        this.timeAutomations[time].push({ name: key, execute_once: configAutomation.execute_once, trigger: timeTrigger, action: actions, condition: conditions });
                    }
                    else if (this.matchTimeString(timeTrigger.time)) {
                        if (!this.timeAutomations[timeTrigger.time])
                            this.timeAutomations[timeTrigger.time] = [];
                        this.timeAutomations[timeTrigger.time].push({ name: key, execute_once: configAutomation.execute_once, trigger: timeTrigger, action: actions, condition: conditions });
                    }
                    else {
                        this.logger.error(`[Automations] Config validation error for [${key}]: time syntax error for ${trigger.time}`);
                        return;
                    }
                }
                if (trigger.entity !== undefined) {
                    const eventTrigger = trigger;
                    if (!this.zigbee.resolveEntity(eventTrigger.entity)) {
                        this.logger.error(`[Automations] Config validation error for [${key}]: trigger entity #${eventTrigger.entity}# not found`);
                        return;
                    }
                    this.logger.info(`[Automations] Registering event automation [${key}] trigger: entity #${eventTrigger.entity}#`);
                    const entities = toArray(eventTrigger.entity);
                    for (const entity of entities) {
                        if (!this.eventAutomations[entity]) {
                            this.eventAutomations[entity] = [];
                        }
                        this.eventAutomations[entity].push({ name: key, execute_once: configAutomation.execute_once, trigger: eventTrigger, action: actions, condition: conditions });
                    }
                }
            }
        });
    }
    matchTimeString(timeString) {
        if (timeString.length !== 8)
            return undefined;
        const match = timeString.match(/(\d{2}):(\d{2}):(\d{2})/);
        if (match && parseInt(match[1], 10) <= 23 && parseInt(match[2], 10) <= 59 && parseInt(match[3], 10) <= 59) {
            const time = new Date();
            time.setHours(parseInt(match[1], 10));
            time.setMinutes(parseInt(match[2], 10));
            time.setSeconds(parseInt(match[3], 10));
            return time;
        }
        return undefined;
    }
    startMidnightTimeout() {
        const now = new Date();
        const timeEvent = new Date();
        timeEvent.setHours(23);
        timeEvent.setMinutes(59);
        timeEvent.setSeconds(59);
        this.logger.debug(`[Automations] Set timeout to reload for time automations`);
        this.midnightTimeout = setTimeout(() => {
            this.logger.info(`[Automations] Run timeout to reload time automations`);
            Object.keys(this.timeAutomations).forEach(key => {
                const timeAutomationArray = this.timeAutomations[key];
                timeAutomationArray.forEach(timeAutomation => {
                    this.startTimeTriggers(key, timeAutomation);
                });
            });
            this.startMidnightTimeout();
        }, timeEvent.getTime() - now.getTime() + 2000);
        this.midnightTimeout.unref();
    }
    startTimeTriggers(key, automation) {
        const now = new Date();
        const timeEvent = this.matchTimeString(key);
        if (timeEvent !== undefined) {
            if (timeEvent.getTime() > now.getTime()) {
                this.logger.debug(`[Automations] Set timout at ${timeEvent.toLocaleString()} for [${automation.name}]`);
                const timeout = setTimeout(() => {
                    delete this.triggerForTimeouts[automation.name];
                    this.logger.debug(`[Automations] Timout for [${automation.name}]`);
                    this.runActionsWithConditions(automation, automation.condition, automation.action);
                }, timeEvent.getTime() - now.getTime());
                timeout.unref();
                this.triggerForTimeouts[automation.name] = timeout;
            }
            else {
                this.logger.debug(`[Automations] Timout at ${timeEvent.toLocaleString()} is passed for [${automation.name}]`);
            }
        }
        else {
            this.logger.error(`[Automations] Timout config error at ${key} for [${automation.name}]`);
        }
    }
    checkTrigger(automation, configTrigger, update, from, to) {
        let trigger;
        let attribute;
        let result;
        let actions;
        if (configTrigger.action !== undefined) {
            if (!Object.prototype.hasOwnProperty.call(update, 'action')) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] no 'action' in update for #${configTrigger.entity}#`);
                return null;
            }
            trigger = configTrigger;
            actions = toArray(trigger.action);
            result = actions.includes(update.action);
            this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger is ${result} for #${configTrigger.entity}# action(s): ${this.stringify(actions)}`);
            return result;
        }
        else if (configTrigger.attribute !== undefined) {
            trigger = configTrigger;
            attribute = trigger.attribute;
            if (!Object.prototype.hasOwnProperty.call(update, attribute) || !Object.prototype.hasOwnProperty.call(to, attribute)) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' published for #${configTrigger.entity}#`);
                return null;
            }
            if (from[attribute] === to[attribute]) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' change for #${configTrigger.entity}#`);
                return null;
            }
            if (typeof trigger.equal !== 'undefined' || typeof trigger.state !== 'undefined') {
                const value = trigger.state !== undefined ? trigger.state : trigger.equal;
                if (to[attribute] !== value) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' != ${value} for #${configTrigger.entity}#`);
                    return false;
                }
                if (from[attribute] === value) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already = ${value} for #${configTrigger.entity}#`);
                    return null;
                }
                this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger equal/state ${value} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
            }
            if (typeof trigger.not_equal !== 'undefined') {
                if (to[attribute] === trigger.not_equal) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' = ${trigger.not_equal} for #${configTrigger.entity}#`);
                    return false;
                }
                if (from[attribute] !== trigger.not_equal) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already != ${trigger.not_equal} for #${configTrigger.entity}#`);
                    return null;
                }
                this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger not equal ${trigger.not_equal} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
            }
            if (typeof trigger.above !== 'undefined') {
                if (to[attribute] <= trigger.above) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' <= ${trigger.above} for #${configTrigger.entity}#`);
                    return false;
                }
                if (from[attribute] > trigger.above) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already > ${trigger.above} for #${configTrigger.entity}#`);
                    return null;
                }
                this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger above ${trigger.above} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
            }
            if (typeof trigger.below !== 'undefined') {
                if (to[attribute] >= trigger.below) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' >= ${trigger.below} for #${configTrigger.entity}#`);
                    return false;
                }
                if (from[attribute] < trigger.below) {
                    this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' already < ${trigger.below} for #${configTrigger.entity}#`);
                    return null;
                }
                this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger below ${trigger.below} is true for #${configTrigger.entity}# ${attribute} is ${to[attribute]} `);
            }
            return true;
        }
        else if (configTrigger.state !== undefined) {
            trigger = configTrigger;
            attribute = 'state';
            if (!Object.prototype.hasOwnProperty.call(update, attribute) || !Object.prototype.hasOwnProperty.call(to, attribute)) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' published for #${configTrigger.entity}#`);
                return null;
            }
            if (from[attribute] === to[attribute]) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] no '${attribute}' change for #${configTrigger.entity}#`);
                return null;
            }
            if (to[attribute] !== trigger.state) {
                this.logger.debug(`[Automations] Trigger check [${automation.name}] '${attribute}' != ${trigger.state} for #${configTrigger.entity}#`);
                return null;
            }
            this.logger.debug(`[Automations] Trigger check [${automation.name}] trigger state ${trigger.state} is true for #${configTrigger.entity}# state is ${to[attribute]}`);
            return true;
        }
        return false;
    }
    checkCondition(automation, condition) {
        let timeResult = true;
        let eventResult = true;
        if (condition.after || condition.before || condition.weekday) {
            timeResult = this.checkTimeCondition(automation, condition);
        }
        if (condition.entity) {
            eventResult = this.checkEntityCondition(automation, condition);
        }
        return (timeResult && eventResult);
    }
    checkTimeCondition(automation, condition) {
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const now = new Date();
        if (condition.weekday && !condition.weekday.includes(days[now.getDay()])) {
            this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for weekday: ${this.stringify(condition.weekday)}`);
            return false;
        }
        if (condition.before) {
            const time = this.matchTimeString(condition.before);
            if (time !== undefined) {
                if (now.getTime() > time.getTime()) {
                    this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for before: ${condition.before}`);
                    return false;
                }
            }
            else {
                this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: before #${condition.before}# ignoring condition`);
            }
        }
        if (condition.after) {
            const time = this.matchTimeString(condition.after);
            if (time !== undefined) {
                if (now.getTime() < time.getTime()) {
                    this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is false for after: ${condition.after}`);
                    return false;
                }
            }
            else {
                this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: after #${condition.after}# ignoring condition`);
            }
        }
        this.logger.debug(`[Automations] Condition check [${automation.name}] time condition is true for ${this.stringify(condition)}`);
        return true;
    }
    checkEntityCondition(automation, condition) {
        if (!condition.entity) {
            this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: condition entity not specified`);
            return false;
        }
        const entity = this.zigbee.resolveEntity(condition.entity);
        if (!entity) {
            this.logger.error(`[Automations] Condition check [${automation.name}] config validation error: entity #${condition.entity}# not found`);
            return false;
        }
        const attribute = condition.attribute || 'state';
        const value = this.state.get(entity)[attribute];
        if (condition.state !== undefined && value !== condition.state) {
            this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not '${condition.state}'`);
            return false;
        }
        if (condition.attribute !== undefined && condition.equal !== undefined && value !== condition.equal) {
            this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not equal '${condition.equal}'`);
            return false;
        }
        if (condition.attribute !== undefined && condition.below !== undefined && value >= condition.below) {
            this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not below '${condition.below}'`);
            return false;
        }
        if (condition.attribute !== undefined && condition.above !== undefined && value <= condition.above) {
            this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is false for entity #${condition.entity}# attribute '${attribute}' is '${value}' not above '${condition.above}'`);
            return false;
        }
        this.logger.debug(`[Automations] Condition check [${automation.name}] event condition is true for entity #${condition.entity}# attribute '${attribute}' is '${value}'`);
        return true;
    }
    runActions(automation, actions) {
        for (const action of actions) {
            const entity = this.zigbee.resolveEntity(action.entity);
            if (!entity) {
                this.logger.error(`[Automations] Entity #${action.entity}# not found so ignoring this action`);
                continue;
            }
            let data;
            if (typeof action.payload === 'string') {
                if (action.payload === ConfigPayload.TURN_ON) {
                    data = { state: ConfigState.ON };
                }
                else if (action.payload === ConfigPayload.TURN_OFF) {
                    data = { state: ConfigState.OFF };
                }
                else if (action.payload === ConfigPayload.TOGGLE) {
                    data = { state: ConfigState.TOGGLE };
                }
                else {
                    this.logger.error(`[Automations] Run automation [${automation.name}] for entity #${action.entity}# error: payload can be turn_on turn_off toggle or an object`);
                    return;
                }
            }
            else if (typeof action.payload === 'object') {
                data = action.payload;
            }
            else {
                this.logger.error(`[Automations] Run automation [${automation.name}] for entity #${action.entity}# error: payload can be turn_on turn_off toggle or an object`);
                return;
            }
            if (action.logger === 'info')
                this.logger.info(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
            else if (action.logger === 'warn')
                this.logger.warn(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
            else if (action.logger === 'error')
                this.logger.error(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
            else
                this.logger.debug(`[Automations] Run automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}#`);
            this.mqtt.onMessage(`${this.mqttBaseTopic}/${entity.name}/set`, buffer_1.Buffer.from(this.payloadStringify(data)));
            if (action.turn_off_after) {
                this.startActionTurnOffTimeout(automation, action);
            }
        }
        if (automation.execute_once === true) {
            this.removeAutomation(automation.name);
        }
    }
    removeAutomation(name) {
        this.log.warning(`Uregistering automation [${name}]`);
        Object.keys(this.eventAutomations).forEach((entity) => {
            this.log.warning(`Entity: #${entity}#`);
            Object.values(this.eventAutomations[entity]).forEach((eventAutomation, index) => {
                if (eventAutomation.name === name) {
                    this.log.warning(`Entity: #${entity}# ${index} event automation: ${eventAutomation.name}`);
                    this.eventAutomations[entity].splice(index, 1);
                }
                else {
                    this.log.info(`Entity: #${entity}# ${index} event automation: ${eventAutomation.name}`);
                }
            });
        });
        Object.keys(this.timeAutomations).forEach((now) => {
            this.log.warning(`Time: #${now}#`);
            Object.values(this.timeAutomations[now]).forEach((timeAutomation, index) => {
                if (timeAutomation.name === name) {
                    this.log.warning(`Time: #${now}# ${index} time automation: ${timeAutomation.name}`);
                    this.timeAutomations[now].splice(index, 1);
                }
                else {
                    this.log.info(`Time: #${now}# ${index} time automation: ${timeAutomation.name}`);
                }
            });
        });
    }
    stopActionTurnOffTimeout(automation, action) {
        const timeout = this.turnOffAfterTimeouts[automation.name + action.entity];
        if (timeout) {
            this.logger.debug(`[Automations] Stop turn_off_after timeout for automation [${automation.name}]`);
            clearTimeout(timeout);
            delete this.turnOffAfterTimeouts[automation.name + action.entity];
        }
    }
    startActionTurnOffTimeout(automation, action) {
        this.stopActionTurnOffTimeout(automation, action);
        this.logger.debug(`[Automations] Start ${action.turn_off_after} seconds turn_off_after timeout for automation [${automation.name}]`);
        const timeout = setTimeout(() => {
            delete this.turnOffAfterTimeouts[automation.name + action.entity];
            const entity = this.zigbee.resolveEntity(action.entity);
            if (!entity) {
                this.logger.error(`[Automations] Entity #${action.entity}# not found so ignoring this action`);
                this.stopActionTurnOffTimeout(automation, action);
                return;
            }
            const data = { state: ConfigState.OFF };
            if (action.logger === 'info')
                this.logger.info(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
            else if (action.logger === 'warn')
                this.logger.warn(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
            else if (action.logger === 'error')
                this.logger.error(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
            else
                this.logger.debug(`[Automations] Turn_off_after timeout for automation [${automation.name}] send ${this.payloadStringify(data)} to entity #${action.entity}# `);
            this.mqtt.onMessage(`${this.mqttBaseTopic}/${entity.name}/set`, buffer_1.Buffer.from(this.payloadStringify(data)));
        }, action.turn_off_after * 1000);
        timeout.unref();
        this.turnOffAfterTimeouts[automation.name + action.entity] = timeout;
    }
    runActionsWithConditions(automation, conditions, actions) {
        for (const condition of conditions) {
            if (!this.checkCondition(automation, condition)) {
                return;
            }
        }
        this.runActions(automation, actions);
    }
    stopTriggerForTimeout(automation) {
        const timeout = this.triggerForTimeouts[automation.name];
        if (timeout) {
            this.logger.debug(`[Automations] Stop trigger-for timeout for automation [${automation.name}]`);
            clearTimeout(timeout);
            delete this.triggerForTimeouts[automation.name];
        }
    }
    startTriggerForTimeout(automation) {
        if (automation.trigger.for === undefined || automation.trigger.for === 0) {
            this.logger.error(`[Automations] Start ${automation.trigger.for} seconds trigger-for timeout error for automation [${automation.name}]`);
            return;
        }
        this.logger.debug(`[Automations] Start ${automation.trigger.for} seconds trigger-for timeout for automation [${automation.name}]`);
        const timeout = setTimeout(() => {
            delete this.triggerForTimeouts[automation.name];
            this.logger.debug(`[Automations] Trigger-for timeout for automation [${automation.name}]`);
            this.runActionsWithConditions(automation, automation.condition, automation.action);
        }, automation.trigger.for * 1000);
        timeout.unref();
        this.triggerForTimeouts[automation.name] = timeout;
    }
    runAutomationIfMatches(automation, update, from, to) {
        const triggerResult = this.checkTrigger(automation, automation.trigger, update, from, to);
        if (triggerResult === false) {
            this.stopTriggerForTimeout(automation);
            return;
        }
        if (triggerResult === null) {
            return;
        }
        const timeout = this.triggerForTimeouts[automation.name];
        if (timeout) {
            this.logger.debug(`[Automations] Waiting trigger-for timeout for automation [${automation.name}]`);
            return;
        }
        else {
            this.logger.debug(`[Automations] Start automation [${automation.name}]`);
        }
        if (automation.trigger.for) {
            this.startTriggerForTimeout(automation);
            return;
        }
        this.runActionsWithConditions(automation, automation.condition, automation.action);
    }
    findAndRun(entityId, update, from, to) {
        const automations = this.eventAutomations[entityId];
        if (!automations) {
            return;
        }
        for (const automation of automations) {
            this.runAutomationIfMatches(automation, update, from, to);
        }
    }
    async start() {
        this.eventBus.onStateChange(this, (data) => {
            this.findAndRun(data.entity.name, data.update, data.from, data.to);
        });
    }
    async stop() {
        this.logger.debug(`[Automations] Extension unloading`);
        for (const key of Object.keys(this.triggerForTimeouts)) {
            this.logger.debug(`[Automations] Clearing timeout ${key}`);
            clearTimeout(this.triggerForTimeouts[key]);
            delete this.triggerForTimeouts[key];
        }
        for (const key of Object.keys(this.turnOffAfterTimeouts)) {
            this.logger.debug(`[Automations] Clearing timeout ${key}`);
            clearTimeout(this.turnOffAfterTimeouts[key]);
            delete this.turnOffAfterTimeouts[key];
        }
        clearTimeout(this.midnightTimeout);
        this.logger.debug(`[Automations] Removing listeners`);
        this.eventBus.removeListeners(this);
        this.logger.debug(`[Automations] Extension unloaded`);
    }
    payloadStringify(payload) {
        return this.stringify(payload, false, 255, 255, 35, 220, 159, 1, '"', '"');
    }
    stringify(payload, enableColors = false, colorPayload = 255, colorKey = 255, colorString = 35, colorNumber = 220, colorBoolean = 159, colorUndefined = 1, keyQuote = '', stringQuote = '\'') {
        const clr = (color) => {
            return enableColors ? `\x1b[38;5;${color}m` : '';
        };
        const reset = () => {
            return enableColors ? `\x1b[0m` : '';
        };
        const isArray = Array.isArray(payload);
        let string = `${reset()}${clr(colorPayload)}` + (isArray ? '[ ' : '{ ');
        Object.entries(payload).forEach(([key, value], index) => {
            if (index > 0) {
                string += ', ';
            }
            let newValue = '';
            newValue = value;
            if (typeof newValue === 'string') {
                newValue = `${clr(colorString)}${stringQuote}${newValue}${stringQuote}${reset()}`;
            }
            if (typeof newValue === 'number') {
                newValue = `${clr(colorNumber)}${newValue}${reset()}`;
            }
            if (typeof newValue === 'boolean') {
                newValue = `${clr(colorBoolean)}${newValue}${reset()}`;
            }
            if (typeof newValue === 'undefined') {
                newValue = `${clr(colorUndefined)}undefined${reset()}`;
            }
            if (typeof newValue === 'object') {
                newValue = this.stringify(newValue, enableColors, colorPayload, colorKey, colorString, colorNumber, colorBoolean, colorUndefined, keyQuote, stringQuote);
            }
            if (isArray)
                string += `${newValue}`;
            else
                string += `${clr(colorKey)}${keyQuote}${key}${keyQuote}${reset()}: ${newValue}`;
        });
        return string += ` ${clr(colorPayload)}` + (isArray ? ']' : '}') + `${reset()}`;
    }
}
const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan, asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 1000 * 60 * 60 * 24, J1970 = 2440588, J2000 = 2451545;
function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date) { return toJulian(date) - J2000; }
const e = rad * 23.4397;
function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b) { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }
function azimuth(H, phi, dec) { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }
function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
function astroRefraction(h) {
    if (h < 0)
        h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}
function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), P = rad * 102.9372;
    return M + C + P + PI;
}
function sunCoords(d) {
    const M = solarMeanAnomaly(d), L = eclipticLongitude(M);
    return {
        dec: declination(L, 0),
        ra: rightAscension(L, 0)
    };
}
const J0 = 0.0009;
function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }
function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }
function hourAngle(h, phi, d) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height) { return -2.076 * Math.sqrt(height) / 60; }
function getSetJ(h, lw, phi, dec, n, M, L) {
    const w = hourAngle(h, phi, dec), a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}
function moonCoords(d) {
    const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d), l = L + rad * 6.289 * sin(M), b = rad * 5.128 * sin(F), dt = 385001 - 20905 * cos(M);
    return {
        ra: rightAscension(l, b),
        dec: declination(l, b),
        dist: dt
    };
}
function hoursLater(date, h) {
    return new Date(date.valueOf() + h * dayMs / 24);
}
class SunCalc {
    constructor() {
        this.times = [
            [-0.833, 'sunrise', 'sunset'],
            [-0.3, 'sunriseEnd', 'sunsetStart'],
            [-6, 'dawn', 'dusk'],
            [-12, 'nauticalDawn', 'nauticalDusk'],
            [-18, 'nightEnd', 'night'],
            [6, 'goldenHourEnd', 'goldenHour']
        ];
    }
    getPosition(date, lat, lng) {
        const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
        return {
            azimuth: azimuth(H, phi, c.dec),
            altitude: altitude(H, phi, c.dec)
        };
    }
    addTime(angle, riseName, setName) {
        this.times.push([angle, riseName, setName]);
    }
    getTimes(date, lat, lng, height) {
        height = height || 0;
        const lw = rad * -lng, phi = rad * lat, dh = observerAngle(height), d = toDays(date), n = julianCycle(d, lw), ds = approxTransit(0, lw, n), M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0), Jnoon = solarTransitJ(ds, M, L);
        let i, len, time, h0, Jset, Jrise;
        const result = {
            solarNoon: fromJulian(Jnoon),
            nadir: fromJulian(Jnoon - 0.5)
        };
        for (i = 0, len = this.times.length; i < len; i += 1) {
            time = this.times[i];
            h0 = (time[0] + dh) * rad;
            Jset = getSetJ(h0, lw, phi, dec, n, M, L);
            Jrise = Jnoon - (Jset - Jnoon);
            result[time[1]] = fromJulian(Jrise);
            result[time[2]] = fromJulian(Jset);
        }
        return result;
    }
    getMoonPosition(date, lat, lng) {
        const lw = rad * -lng, phi = rad * lat, d = toDays(date), c = moonCoords(d), H = siderealTime(d, lw) - c.ra;
        let h = altitude(H, phi, c.dec);
        const pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));
        h = h + astroRefraction(h);
        return {
            azimuth: azimuth(H, phi, c.dec),
            altitude: h,
            distance: c.dist,
            parallacticAngle: pa
        };
    }
    getMoonIllumination(date) {
        const d = toDays(date || new Date()), s = sunCoords(d), m = moonCoords(d), sdist = 149598000, phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)), inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)), angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) -
            cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
        return {
            fraction: (1 + cos(inc)) / 2,
            phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
            angle: angle
        };
    }
    getMoonTimes(date, lat, lng, inUTC) {
        const t = new Date(date);
        if (inUTC)
            t.setUTCHours(0, 0, 0, 0);
        else
            t.setHours(0, 0, 0, 0);
        const hc = 0.133 * rad;
        let h0 = this.getMoonPosition(t, lat, lng).altitude - hc;
        let h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;
        for (let i = 1; i <= 24; i += 2) {
            h1 = this.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
            h2 = this.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;
            a = (h0 + h2) / 2 - h1;
            b = (h2 - h0) / 2;
            xe = -b / (2 * a);
            ye = (a * xe + b) * xe + h1;
            d = b * b - 4 * a * h1;
            roots = 0;
            if (d >= 0) {
                dx = Math.sqrt(d) / (Math.abs(a) * 2);
                x1 = xe - dx;
                x2 = xe + dx;
                if (Math.abs(x1) <= 1)
                    roots++;
                if (Math.abs(x2) <= 1)
                    roots++;
                if (x1 < -1)
                    x1 = x2;
            }
            if (roots === 1) {
                if (h0 < 0)
                    rise = i + x1;
                else
                    set = i + x1;
            }
            else if (roots === 2) {
                rise = i + (ye < 0 ? x2 : x1);
                set = i + (ye < 0 ? x1 : x2);
            }
            if (rise && set)
                break;
            h0 = h2;
        }
        const result = {};
        if (rise)
            result[rise] = hoursLater(t, rise);
        if (set)
            result[set] = hoursLater(t, set);
        if (!rise && !set)
            result[ye > 0 ? 'alwaysUp' : 'alwaysDown'] = true;
        return result;
    }
}
module.exports = AutomationsExtension;