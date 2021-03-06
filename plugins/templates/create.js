'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-template-validator');
const templateSchema = schema.api.templateValidator;
const hoek = require('hoek');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/templates',
    config: {
        description: 'Create a new template',
        notes: 'Create a specific template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => validator(request.payload.yaml)
            .then((config) => {
                if (config.errors.length > 0) {
                    throw boom.badRequest(
                        'Template has invalid format: ', config.errors.toString());
                }

                const pipelineFactory = request.server.app.pipelineFactory;
                const templateFactory = request.server.app.templateFactory;
                const pipelineId = request.auth.credentials.pipelineId;

                return Promise.all([
                    pipelineFactory.get(pipelineId),
                    templateFactory.list({ params: { name: config.template.name } })
                ]).then(([pipeline, templates]) => {
                    const templateConfig = hoek.applyToDefaults(config.template, {
                        pipelineId: pipeline.id,
                        labels: config.template.labels || []
                    });

                    // If template name doesn't exist yet, just create a new entry
                    if (templates.length === 0) {
                        return templateFactory.create(templateConfig);
                    }

                    // If template name exists, but this build's pipelineId is not the same as template's pipelineId
                    // Then this build does not have permission to publish
                    if (pipeline.id !== templates[0].pipelineId) {
                        throw boom.unauthorized('Not allowed to publish this template');
                    }

                    // If template name exists and has good permission, then create
                    // Create would automatically bump the patch version
                    return templateFactory.create(templateConfig);
                });
            }).then((template) => {
                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: `${request.path}/${template.id}`
                });

                return reply(template.toJson()).header('Location', location).code(201);
            }).catch(err => reply(boom.wrap(err))),
        validate: {
            payload: templateSchema.input
        }
    }
});
