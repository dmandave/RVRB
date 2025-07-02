# RVRB
Listen to music with your pals, whether they're next-door or across the world - checkout https://rvrb.one/

## Reporting issues, rasing suggestions for new features or enhancements
Please feel free to [raise an issue](https://github.com/soundengineering/RVRB/issues/new) with as much detail as you can and we'll review, triage and prioritise into the right part of the project.

## RVRB 2.0
After 1 year of use and clearer views on usage patterns, pain points from a user perspective and development bottlenecks, we've begun designing the next iteration of RVRB.
The aim is to increase stability and robustness of the platform, while allowing faster iteration of new features.

We're using githubs project function to track progress and you can view that [here](https://github.com/orgs/soundengineering/projects/1).

In time, we will add diagrams and more details to the [wiki](https://github.com/soundengineering/RVRB/wiki).

## Contributing
We're more than happy to accept contributions from anyone. Please raise a pull request on any part of the project you'd like and it will be reviewed and tested in due course.

### Running locally
To get started running RVRB locally, take a look at the [infrastructure repo](https://github.com/soundengineering/infrastructure) for guidance on getting everything setup locally.

## Bot Deployment

### Environment Setup
1. Copy `env.example` to `.env`:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` with your actual values:
   - **RVRB Configuration**: Your RVRB API key, channel ID, and bot name
   - **API Keys**: Various service API keys for image generation, weather, etc.
   - **Google Cloud**: Your GCP instance name, zone, and project ID

### Deploying the Bot
Use the deploy script to upload and restart the bot:
```bash
./deploy-bot.sh
```

The script will:
- Load environment variables from `.env`
- Upload the latest `ws-client.js` to your GCP instance
- Restart the bot using PM2
- Show the bot status

### Security Notes
- The `.env` file is automatically ignored by git
- Never commit your actual API keys or instance details
- Use the `env.example` file as a template for required variables
