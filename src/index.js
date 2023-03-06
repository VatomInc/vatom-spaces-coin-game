import { BasePlugin, BaseComponent } from 'vatom-spaces-plugins'

/**
 * This is the main entry point for your plugin.
 *
 * All information regarding plugin development can be found at
 * https://developer.vatom.com/plugins/plugins/
 *
 * @license MIT
 * @author Vatom Inc.
 */

let runningComponents = []

// list of themes
const Themes = [

    // Default theme
    {
        id: 'default',
        name: 'Golden Coins',
        scorePage: 'notice-overlay.html'
    },

    // Ice theme
    {
        id: 'ice',
        name: 'Ice Gem',
        scorePage: 'notice-overlay-ice.html'
    }

]

export default class CoinPickupGame extends BasePlugin {

    /** Plugin info */
    static id = "game-coin-pickup"
    static name = "Coin Pickup Game"
    static description = "A game where users can walk over coins to collect them."

    async onLoad() {

        // Current points
        this.score = 0

        // Register coin component
        this.objects.registerComponent(Coin, {
            id: 'coin',
            name: 'Collectible Coin'
        })

        // Register coin spawner component
        this.objects.registerComponent(CoinSpawner, {
            id: 'coin-spawner',
            name: 'Collectible Coin Spawner',
            serverTick: true,
            settings: [
                { id: 'enabled', name: 'Enabled', type: 'checkbox', help: 'If disabled, new coins will not spawn.' },
                { id: 'pickup-sound', name: 'Pickup Sound', type: 'file', help: 'The sound to play when picking up a coin. Leave blank for the default.' },
                { id: 'model', name: 'Coin Model', type: 'file', help: 'The GLB model file of the coin. Leave blank for the default. If this is blank and Vatom ID is specified, the dropped object will use the model specified in the vatom instead of the default model.' },
                { id: 'model-own-animation', name: "Use Model Animation", type: 'checkbox', help: "If enabled, the coin model will not rotate and instead will use the animation inside the GLB, if any. You can enable this even if you just want to disable rotation and have no animation at all." },
                { id: 'spawn-radius', name: 'Spawn Radius', type: 'number', help: 'The distance around this object to start spawning coins. Default = 10 meters, minimum = 5 meters, maximum = 500 meters.' },
                { id: 'spawn-rate', name: 'Spawn Rate', type: 'number', help: 'Number of seconds between coin spawns. Minimum = 15 seconds.'},
                { id: 'spawn-chance', name: 'Spawn Chance', type: 'number', help: 'Percentage chance that a coin will spawn. Default = 100.'},
                { id: 'spawn-amount', name: 'Spawn Amount', type: 'number', help: 'Number of coins to spawn each cycle. Each coin is still affected by the Spawn Chance field.'},
                { id: 'score', name: 'Score Value', type: 'number', help: 'Amount to increase the score by when picked up. Default = 1.'},
                { id: 'max-coins', name: 'Max Coins', type: 'number', help: 'The maximum number of coins to spawn within the radius. Default = 10.' },
                { id: 'vatom-id', name: 'Vatom ID', type: 'text', help: "If specified, the user will get a copy of this vatom when they pick up a coin. This is achieved by calling AcquirePubVariation on the associated vatom ID from the user's vatom wallet account.\n\nThis vatom must be publicly visible in order for this to work." },
                { id: 'action-spawn-now', name: 'Spawn a coin now', type: 'button' },
                { id: 'action-remove-all', name: 'Remove all coins', type: 'button' },
            ]
        })

        // Stop here if on the server
        if (this.isServer)
            return

        // Register configuration page
        this.menus.register({
            id: 'config',
            section: 'plugin-settings',
            panel: {
                fields: [

                    // Theme section
                    { type: 'section', name: 'Appearance' },
                    { type: 'select', id: 'theme', name: 'Theme', values: Themes.map(t => t.name), help: "The theme to use for the score counter. You may need to refresh the page to see changes." },
                    
                    // Scoring section
                    { type: 'section', name: 'Scoring' },
                    { type: 'select', id: 'score-method', name: 'Method', values: ['In memory', 'Vatom', 'VatomInc Campaign'], help: "Select how points will be stored." },
                    { type: 'text', id: 'vatom-template', name: 'Vatom template variation', help: "The Score vatom's template variation, if using the Vatom scoring method." },
                    { type: 'text', id: 'vatominc-campaign-id', name: 'VatomInc campaign ID', help: "The campaign ID when using the VatomInc Campaign scoring method." },

                    // Limiting section
                    { type: 'section', name: 'Score limits' },
                    { type: 'text', id: 'minimum-score', name: 'Minimum Score', help: "If the user's score is at this or below, negative coins will not be picked up. Set this field blank to not include a limit." },
                    { type: 'text', id: 'minimum-score-msg', name: 'Minimum Score Message', help: "Displayed if the user's score goes too low." },
                    { type: 'text', id: 'maximum-score', name: 'Maximum Score', help: "If the user's score is at this or higher, positive coins will not be picked up. Set this field blank to not include a limit." },
                    { type: 'text', id: 'maximum-score-msg', name: 'Maximum Score Message', help: "Displayed if the user's score goes too high." },

                ]
            }
        })

        // Register the overlay UI
        let currentTheme = Themes.find(t => t.name == this.getField('theme')) || Themes[0]
        this.infoOverlayID = this.menus.register({
            section: 'infopanel',
            panel: {
                iframeURL: absolutePath(currentTheme.scorePage),
                width: 300,
                height: 100
            }
        })
        
        // Start a distance check timer
        this.timer = setInterval(this.onTimer.bind(this), 200)

        // Fetch score
        if (this.getField('score-method') == 'Vatom')
            this.fetchScoreFromVatom()
        else if (this.getField('score-method') == 'VatomInc Campaign')
            this.fetchScoreFromVatomInc()

    }

    onUnload() {

        // Remove timer
        clearInterval(this.timer)

    }

    /** Fetch the score vatom and update the score */
    async fetchScoreFromVatom() {

        // Fetch the vatom
        let templateVariation = this.getField('vatom-template')
        let vatoms = await this.hooks.trigger("vatoms.searchInventory", { templateVariation })
        if (vatoms && vatoms.length >= 1) {
            
            // Use score from the vatom
            let vatom = vatoms[0]
            this.score = vatom.private && vatom.private["user-points-v1"] && vatom.private["user-points-v1"].total || 0
            this.scoreVatom = vatom
            this.updateScore()

        } else {

            // Vatom not found!
            console.warn(`[Coin Game] The Score vatom was not found in the user's inventory. Score will be reset to 0 on start.`)

        }

    }

    /** fetch the score from the VatomInc campaign API */
    async fetchScoreFromVatomInc() {

        // Get campaign ID
        let campaignID = this.getField('vatominc-campaign-id')
        if (!campaignID) 
            return console.warn('[Coin Pickup Game] Warning: No campaign ID was specified.')

        // Request points
        let result = await this.hooks.trigger('vatoms.campaigns.points.get', { campaignID })
        if (!result)
            return console.warn('[Coin Pickup Game] Warning: The Vatoms plugin needs to be installed in order to use the VatomInc Campaign scoring method.')

        // Done
        this.score = result.game || 0
        this.updateScore()

    }

    async onTimer() {

        // Get user's position
        let userPos = await this.user.getPosition()

        // Run each component's timer
        for (let comp of runningComponents)
            comp.onTimer(userPos)

    }

    /** Called on message */
    async onMessage(data) {

        // Update score now if panel loaded
        if (data.action == 'panel-load')
            return this.updateScore()

        // Return coin message aler
        if (data.action == 'coin-alert')
            return this.menus.alert(null, 'Find the hidden coins in this space to increase your score!')

        if (data.action == 'coin-alert-ice')
            return this.menus.alert(null, 'Capture the cold blue gems and gain 10 points. Avoid the hot flames - they take 10 points away from your score. Keep on playing up to 450 points!')

    }

    /** Show score increase */
    async updateScore() {

        // Send score to panel
        this.menus.postMessage({ action: 'set-score', score: this.score })

    }

}

class CoinSpawner extends BaseComponent {

    /** Called on load */
    onLoad() {

        

    }

    /** Called on action */
    async onAction(action) {

        // Check action
        if (action == 'action-spawn-now') {

            // Spawn a coin
            await this.spawnCoin().catch(err => {

                // Show error to the user
                console.error(err)
                this.plugin.menus.alert(err.message, "Unable to spawn coin", 'error')

            })

        } else if (action == 'action-remove-all') {

            // Remove all
            await this.removeAllCoins()

        }

    }

    /** Called on the server every 30 seconds */
    async onServerTick() {

        // Stop if disabled
        if (!this.getField('enabled'))
            return

        // Get nearby coins
        console.log(`[Coin Game] On server: Fetching nearby coins...`)
        let allObjects = await this.plugin.objects.fetchInRadius(this.fields.x || 0, this.fields.y || 0, 500)

        // Filter out ones that don't belong to us
        let allCoins = allObjects.filter(obj => obj.coin_spawner_id == this.objectID)
        let lastCoinAddedAt = allCoins.reduce((last, currentObj) => Math.max(last || 0, currentObj.lastModified || 0), 0)
        console.log(`[Coin Game] On server: Found ${allCoins.length} nearby coins, last added at ${lastCoinAddedAt}`)

        // Check if there are too many already
        let maxCoins = parseFloat(this.getField('max-coins')) || 10
        if (allCoins.length >= maxCoins)
            return console.log(`[Coin Game] On server: Too many coins spawned, skipping.`)

        // Check if we need to spawn more
        let spawnRateSeconds = Math.max(15, parseFloat(this.getField('spawn-rate')) || 0)
        let nextSpawnTime = lastCoinAddedAt + spawnRateSeconds*1000
        if (Date.now() < nextSpawnTime)
            return console.log(`[Coin Game] On server: Not yet time for another coin spawn.`)

        // Run coin spawner cycle
        let numCoins = Math.max(1, parseInt(this.getField('spawn-amount')) || 1)
        for (let i = 0 ; i < numCoins ; i++)
            await this.spawnCoinChance(allCoins)

    }

    async spawnCoinChance(allCoins) {

        // Check spawn chance
        let spawnChance = Math.min(100, Math.max(0, parseFloat(this.getField('spawn-chance')) || 100)) / 100
        let pickedChance = Math.random()
        if (pickedChance > spawnChance)
            return console.log(`[Coin Game] On server: Spawn chance didn't succeed, skipping. chance=${spawnChance} picked=${pickedChance}`)

        // Spawn a coin
        await this.spawnCoin()

    }

    /** Spawn a new coin. Must be called by an admin user or on the server. */
    async spawnCoin() {

        // Create new coin properties
        let spawnRadius = Math.min(500, Math.max(5, parseFloat(this.getField('spawn-radius')) || 10))
        let newCoinProps = {
            x: (this.fields.x || 0) + Math.random()*spawnRadius*2 - spawnRadius,
            y: (this.fields.y || 0) + Math.random()*spawnRadius*2 - spawnRadius,
            name: '[Coin] ' + (this.fields.name || 'Untitled'),
            height: this.fields.height || 0,
            type: 'model',
            url: this.getField('model') || absolutePath('gold-pirate-coin.glb'),
            coin_spawner_id: this.objectID,
            rotation_speed: this.getField('model-own-animation') ? 0 : 2,
            do_not_clone: this.getField('model-own-animation') ? true : false,
            clientOnly: false,
            ['component:' + this.plugin.id + ':coin:' + 'pickup-sound']: this.getField('pickup-sound') || absolutePath('collect.wav'),
            ['component:' + this.plugin.id + ':coin:' + 'score']: this.getField('score') || "",
            ['component:' + this.plugin.id + ':coin:' + 'record-vatom-score']: this.getField('record-vatom-score') || "",
            ['component:' + this.plugin.id + ':coin:' + 'vatom-id']: this.getField('vatom-id') || "",
            components: [
                { id: this.plugin.id + ':coin' }
            ]
        }

        // If this is a vatom, modify fields based on vatom properties
        if (this.getField('vatom-id') && !this.getField('model'))
            await this.applyVatomFields(this.getField('vatom-id'), newCoinProps)

        // Create a coin
        console.log(`[Coin Game] Spawning coin at ${newCoinProps.x}, ${newCoinProps.y}`)
        await this.plugin.objects.create(newCoinProps)

    }

    /** Fetch vatom fields, and apply it to the props when creating the coin object */
    async applyVatomFields(vatomID, newCoinProps) {

        // Check for cached version
        if (!this.cachedVatomInfo) this.cachedVatomInfo = {}
        let vatomInfo = this.cachedVatomInfo[vatomID]
        
        // Remove from cache if too old
        if (vatomInfo && Date.now() - vatomInfo.date > 1000 * 60) {
            vatomInfo = null
            delete this.cachedVatomInfo[vatomID]
        }

        // If not found in cache, fetch it
        if (!vatomInfo) {

            // Fetch it
            console.debug(`[Coin Spawner] Fetching vatom info...`)
            let json = await fetch("https://api.vi.vatom.network/v1/vatoms/" + vatomID, {
                headers: {
                    'App-Id': '37914cb6-0267-44dc-a50b-5bc3a8a74e80'
                }
            }).then(r => r.json())

            // Stop on error
            if (json.error || !json.payload)
                throw new Error("Unable to fetch vatom info for " + vatomID + ": " + json.message)

            // Store it
            this.cachedVatomInfo[vatomID] = vatomInfo = {
                date: Date.now(),
                payload: json.payload
            }

        }

        // Get vatom icon
        let iconRes = vatomInfo.payload["vAtom::vAtomType"].resources.find(r => r.name == 'ActivatedImage')
        let icon = iconRes && iconRes.value && iconRes.value.value || ""

        // Adjust object properties
        newCoinProps.type = 'vatom'
        newCoinProps.vatomID = this.getField('vatom-id')
        newCoinProps.iconURL = icon
        newCoinProps.interaction_mode = 'panel',
        newCoinProps.interaction_no_background = vatomInfo.payload.private.hf_no_border || 0,
        newCoinProps.transparent = true
        newCoinProps.use_original_scale = vatomInfo.payload.private.use_original_scale || false
        newCoinProps.scale = vatomInfo.payload.private.hf_scale || 1
        newCoinProps.locked = true  // <-- Prevents pickup via the normal pickup button, since that won't work

        // Add model URL as well
        let modelRes = vatomInfo.payload['vAtom::vAtomType'].resources.find(r => r.name == 'Scene')
        if (modelRes)
            newCoinProps.modelURL = modelRes.value.value

    }

    /** Remove all coins */
    async removeAllCoins() {

        // Get nearby coins
        console.log(`[Coin Game] Fetching nearby coins...`)
        let allObjects = await this.plugin.objects.fetchInRadius(this.fields.x || 0, this.fields.y || 0, 500)

        // Filter out ones that don't belong to us
        let allCoins = allObjects.filter(obj => obj.coin_spawner_id == this.objectID)

        // Remove all
        await Promise.all(allCoins.map(c => this.plugin.objects.remove(c.id)))

    }

}

class Coin extends BaseComponent {

    onLoad() {

        // Generate instance ID
        this.instanceID = Math.random().toString(36).substr(2)

        // Store it
        runningComponents.push(this)

        // Preload sound
        let pickupSound = this.getField('pickup-sound')
        if (pickupSound)
            this.plugin.audio.preload(pickupSound)

    }

    onUnload() {

        // Remove it
        runningComponents = runningComponents.filter(c => c != this)

        // Stop claim timer
        if (this.clearClaimingTimer) clearTimeout(this.clearClaimingTimer)
        this.clearClaimingTimer = null

    }

    onAction(action) {

        if (action == 'remove-coin') {

            // Remove this coin
            this.plugin.objects.remove(this.objectID)

        }

    }

    onMessage(msg) {

        // Check if it's a claiming message
        if (msg.action == 'claiming') {

            // Stop if we were the sender
            if (msg.fromInstance == this.instanceID)
                return

            // Hide it
            this.plugin.objects.update(this.objectID, { hidden: true }, true)

            // Play sound
            let pickupSound = this.getField('pickup-sound')
            if (pickupSound)
                this.plugin.audio.play(pickupSound, { x: this.fields.x || 0, y: this.fields.y || 0, height: this.fields.height || 0, radius: 10 })

            // Create a reset timer
            if (this.clearClaimingTimer) clearTimeout(this.clearClaimingTimer)
            this.clearClaimingTimer = setTimeout(e => this.onClaimFailed(), 15000)

        } else if (msg.action == 'claim-failed') {

            this.onClaimFailed()

        }

    }

    /** This function is called in the case where another user claims the coin, but their claim fails and they don't actually get it */
    onClaimFailed() {

        // Stop claim timer
        if (this.clearClaimingTimer) clearTimeout(this.clearClaimingTimer)
        this.clearClaimingTimer = null

        // Show the coin again
        this.plugin.objects.update(this.objectID, { hidden: false }, true)

    }

    onTimer(userPos) {

        // Calculate distance between the user and this object
        let x = this.fields.x       || 0
        let y = this.fields.height  || 0
        let z = this.fields.y       || 0
        let distance = Math.sqrt((x - userPos.x) ** 2 + /*(y - userPos.y) ** 2 +*/ (z - userPos.z) ** 2)

        // Stop if far away
        if (distance > 1) {
            this.lastPickupFailed = false
            return
        }

        // If last pickup failed, wait until the user leaves and comes back
        if (this.lastPickupFailed) 
            return

        // Only do once
        if (this.hasPickedUp) return
        this.hasPickedUp = true

        // Play sound effect
        console.debug(`[Coin Game] Picking up coin with ID ${this.objectID}`)

        // Play sound
        let pickupSound = this.getField('pickup-sound')
        if (pickupSound)
            this.plugin.audio.play(pickupSound)

        // Hide object
        this.plugin.objects.update(this.objectID, { hidden: true }, true)

        // Notify other users that we claimed it
        this.sendMessage({ 
            action: 'claiming',
            fromInstance: this.instanceID
        })

        // Get score value
        let scoreValue = parseFloat(this.getField('score')) || 1
        
        // Increase score
        this.plugin.score += scoreValue
        this.plugin.updateScore()

        // Attempt to pick it up
        this.doPickup().catch(err => {

            // On fail, reset state
            console.warn(`[Coin Game] Unable to pick up coin.`, err)
            this.hasPickedUp = false
            this.plugin.objects.update(this.objectID, { hidden: false }, true)
            this.sendMessage({ action: 'claim-failed' })

            // Show score
            this.plugin.score -= scoreValue
            this.plugin.updateScore()

            // Notify user
            if (err.message == this.plugin.getField('maximum-score-msg') || err.message == this.plugin.getField('minimum-score-msg')) {
                this.plugin.menus.alert(null, err.message)
            } else {
                this.plugin.menus.alert(err.message, 'Could not update your score', 'warning')
            }
            
            // Disable pickup of this coin until moved away
            this.lastPickupFailed = true

        })

    }

    /** Pick up this coin */
    async doPickup() {

        // Get score value
        let scoreValue = parseFloat(this.getField('score')) || 1
        let actualScore = this.plugin.score - scoreValue
        let minScoreStr = this.plugin.getField('minimum-score')
        let minScore = parseFloat(minScoreStr)
        let minScoreEnabled = minScoreStr && minScoreStr.length > 0 && !isNaN(minScore)
        let maxScoreStr = this.plugin.getField('maximum-score')
        let maxScore = parseFloat(maxScoreStr)
        let maxScoreEnabled = maxScoreStr && maxScoreStr.length > 0 && !isNaN(maxScore)

        // Check the score limiter
        if (scoreValue > 0 && maxScoreEnabled && actualScore >= maxScore)
            throw new Error(this.plugin.getField('maximum-score-msg') || "Your score is already at the maximum!")
        if (scoreValue < 0 && minScoreEnabled && actualScore <= minScore)
            throw new Error(this.plugin.getField('minimum-score-msg') || "Your score is already at the minimum!")

        // Run the hook
        let hookResult = await this.plugin.hooks.trigger('coinpickupgame.onPickedUp', { object: this.fields })
        if (hookResult)
            throw new Error(hookResult.error || 'Coin pickup interrupted by hook.')

        // Check if we should acquire a vatom
        if (this.getField('vatom-id')) {

            // Run a vatom acquire
            let result = await this.plugin.hooks.trigger('vatoms.performAction', {
                vatomID: this.getField('vatom-id'),
                actionName: 'AcquirePubVariation'
            })

            // Stop if no result
            if (!result)
                throw new Error("The Vatom plugin was not able to perform the action. Please check if the Vatom plugin is installed in this space.")

        }

        // Check how to record the score
        if (this.plugin.getField('score-method') == 'Vatom') {

            // Find vatom
            if (!this.plugin.scoreVatom) {

                // Attempt to find it now
                await this.plugin.fetchScoreFromVatom()

                // Stop if still not found
                if (!this.plugin.scoreVatom)
                    throw new Error("We could not find the Score vatom in your inventory. Please open the wallet and try again.")

            }

            // Tell the Vatom plugin to run the action
            let result = await this.plugin.hooks.trigger('vatoms.performAction', {
                vatomID: this.plugin.scoreVatom.id,
                actionName: 'varius.action:varius.io:update-points-v1',
                actionData: {
                    points: parseFloat(this.getField('score')) || 1,
                    source: 'spatialweb:coin-pickup-game'
                }
            })

            // Stop if not successful
            if (!result) throw new Error("Vatom action failed! The vatom plugin is not installed.")
            if (result.error) throw new Error("Vatom action failed! " + result.error)

        } else if (this.plugin.getField('score-method') == 'VatomInc Campaign') {

            // Get campaign ID
            let campaignID = this.plugin.getField('vatominc-campaign-id')
            if (!campaignID) 
                throw new Error('No campaign ID was specified in the plugin configuration.')

            // Request points
            let result = await this.plugin.hooks.trigger('vatoms.campaigns.points.add', { campaignID, channel: 'game', points: parseFloat(this.getField('score')) || 1 })
            if (!result)
                throw new Error('The Vatoms plugin needs to be installed in order to use the VatomInc Campaign scoring method.')

            // Done
            this.plugin.score = result.game || 0
            this.plugin.updateScore()

        }

        // Success! Call the server to remove this object
        await this.performServerAction('remove-coin')

    }

}
